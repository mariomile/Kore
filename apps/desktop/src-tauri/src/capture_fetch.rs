//! The bounded fetch primitives capture enrichment uses to reach arbitrary
//! hosts: a page's HTML for its meta tags, an oEmbed answer, and a JSON or
//! XML document (a pasted link's saved text). They live here rather than
//! widening the webview's HTTP-plugin capability to every URL, and the
//! privacy gate in `@reflect/core` runs before any of them is called.
//!
//! Which URLs are asked is policy in core; each command only bounds the
//! transport: scheme, redirects, accepted content type and a byte cap. The
//! three share one request path ([`fetch_bounded`]) and differ only in those
//! bounds.

use std::time::Duration;

use reqwest::redirect::Policy;

use crate::error::{AppError, AppResult};

const FETCH_TIMEOUT: Duration = Duration::from_secs(15);

/// The fetches present as a mainstream browser navigation: sites that gate
/// on client fingerprint (Instagram among them) can answer bare app user
/// agents with login walls or challenges a normal browser request never
/// sees. Safari's platform token is frozen upstream, so the string stays
/// plausible without tracking macOS releases.
const FETCH_USER_AGENT: &str = concat!(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ",
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15"
);

/// How much HTML the meta scrape reads. Sized for the worst page measured:
/// a YouTube watch page is ~1.2 MiB of identity-encoded HTML with every
/// meta tag at ~690 KiB, near the end of a ~697 KiB `<head>` (2026-08).
/// 2 MiB keeps whole pages of that shape, with margin for head growth,
/// while still bounding what this command buffers and ships over IPC.
const META_FETCH_MAX_BYTES: usize = 2 * 1024 * 1024;

/// oEmbed answers are ~1 KB of JSON; anything past this cap is not an oEmbed
/// answer.
const OEMBED_FETCH_MAX_BYTES: usize = 64 * 1024;

/// A video's caption track is the largest document the data fetch exists
/// for: an hour of speech is ~1 MiB of timed-text XML.
const DATA_FETCH_MAX_BYTES: usize = 4 * 1024 * 1024;

fn classify_fetch_error(err: reqwest::Error) -> AppError {
    if err.is_timeout() || err.is_connect() || err.is_request() {
        AppError::Network {
            message: err.to_string(),
        }
    } else {
        AppError::io(err.to_string())
    }
}

/// Map a response status to its error: `None` for success, retryable
/// `Network` for server errors and rate limiting (sites like Instagram
/// answer `429` to bursts and recover; the enrichment pass keeps the capture
/// pending and tries again later), permanent `io` for everything else.
fn classify_fetch_status(url: &str, status: reqwest::StatusCode) -> Option<AppError> {
    if status.is_success() {
        return None;
    }
    let message = format!("{url} answered {status}");
    if status.is_server_error() || status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Some(AppError::Network { message });
    }
    Some(AppError::io(message))
}

/// What a fetch does with a body past its byte cap.
enum Oversize {
    /// Keep the head: HTML meta tags still parse from a cut page.
    Cut,
    /// Fail: truncated JSON or XML does not parse.
    Refuse,
}

/// The bounds one fetch primitive enforces.
struct Bounds {
    redirects: Policy,
    /// Answer content types it accepts, matched as lowercase substrings.
    content_types: &'static [&'static str],
    /// How a refused content type is described in the error.
    expected: &'static str,
    max_bytes: usize,
    oversize: Oversize,
}

/// Send `build`'s request under `bounds` and read the answer's bytes.
async fn fetch_bounded(
    url: &str,
    bounds: Bounds,
    build: impl FnOnce(&reqwest::Client) -> reqwest::RequestBuilder,
) -> AppResult<Vec<u8>> {
    let client = reqwest::Client::builder()
        .redirect(bounds.redirects)
        .timeout(FETCH_TIMEOUT)
        .user_agent(FETCH_USER_AGENT)
        .build()
        .map_err(|err| AppError::io(err.to_string()))?;
    let mut response = build(&client).send().await.map_err(classify_fetch_error)?;
    if let Some(err) = classify_fetch_status(url, response.status()) {
        return Err(err);
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase(); // MIME types are case-insensitive (`TEXT/HTML`)
    if !bounds
        .content_types
        .iter()
        .any(|accepted| content_type.contains(accepted))
    {
        return Err(AppError::parse(format!(
            "{url} did not answer {} ({content_type})",
            bounds.expected
        )));
    }
    let mut body: Vec<u8> = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(classify_fetch_error)? {
        let remaining = bounds.max_bytes - body.len();
        if chunk.len() <= remaining {
            body.extend_from_slice(&chunk);
            continue;
        }
        match bounds.oversize {
            Oversize::Cut => {
                body.extend_from_slice(&chunk[..remaining]);
                break;
            }
            Oversize::Refuse => {
                return Err(AppError::parse(format!(
                    "{url} answered more than {} bytes",
                    bounds.max_bytes
                )))
            }
        }
    }
    Ok(body)
}

fn utf8(url: &str, body: Vec<u8>) -> AppResult<String> {
    String::from_utf8(body)
        .map_err(|err| AppError::parse(format!("{url} answered non-UTF-8: {err}")))
}

fn require_https(url: &str) -> AppResult<()> {
    if url.starts_with("https://") {
        Ok(())
    } else {
        Err(AppError::parse(format!("not an https url: {url}")))
    }
}

/// Fetch a captured page's HTML for meta-tag scraping: http(s), up to five
/// redirects, HTML only, the head of the page past the byte cap.
#[tauri::command]
pub async fn capture_meta_fetch(url: String) -> AppResult<String> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err(AppError::parse(format!("not an http(s) url: {url}")));
    }
    let bounds = Bounds {
        redirects: Policy::limited(5),
        content_types: &["html"],
        expected: "an HTML page",
        max_bytes: META_FETCH_MAX_BYTES,
        oversize: Oversize::Cut,
    };
    let body = fetch_bounded(&url, bounds, |client| {
        client
            .get(&url)
            // The full header set a browser sends on a typed-URL navigation;
            // absent Sec-Fetch/Accept-Language headers are themselves a bot
            // signal to fingerprinting CDNs.
            .header(
                "Accept",
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            )
            .header("Accept-Language", "en-US,en;q=0.9")
            .header("Sec-Fetch-Dest", "document")
            .header("Sec-Fetch-Mode", "navigate")
            .header("Sec-Fetch-Site", "none")
            .header("Upgrade-Insecure-Requests", "1")
    })
    .await?;
    Ok(String::from_utf8_lossy(&body).into_owned())
}

/// Fetch an oEmbed endpoint's JSON answer (endpoints are policy in core,
/// `actions/oembed`): https only, JSON only, a small cap, and no redirects,
/// since oEmbed endpoints answer directly.
#[tauri::command]
pub async fn capture_oembed_fetch(url: String) -> AppResult<String> {
    require_https(&url)?;
    let bounds = Bounds {
        redirects: Policy::none(),
        content_types: &["json"],
        expected: "JSON",
        max_bytes: OEMBED_FETCH_MAX_BYTES,
        oversize: Oversize::Refuse,
    };
    let body = fetch_bounded(&url, bounds, |client| {
        client.get(&url).header("Accept", "application/json")
    })
    .await?;
    utf8(&url, body)
}

/// Fetch one JSON or XML document as text, optionally POSTing a JSON body:
/// the transport for the text a pasted link keeps (a video's player answer
/// and caption track; policy in core, `actions/link-text`). https only, JSON
/// or XML only, a byte cap, no redirects.
#[tauri::command]
pub async fn capture_data_fetch(url: String, json_body: Option<String>) -> AppResult<String> {
    require_https(&url)?;
    let bounds = Bounds {
        redirects: Policy::none(),
        content_types: &["json", "xml"],
        expected: "JSON or XML",
        max_bytes: DATA_FETCH_MAX_BYTES,
        oversize: Oversize::Refuse,
    };
    let body = fetch_bounded(&url, bounds, |client| {
        let request = match json_body {
            Some(body) => client
                .post(&url)
                .header(reqwest::header::CONTENT_TYPE, "application/json")
                .body(body),
            None => client.get(&url),
        };
        request
            .header("Accept", "application/json, application/xml, text/xml")
            .header("Accept-Language", "en-US,en;q=0.9")
    })
    .await?;
    utf8(&url, body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fetch_statuses_classify_rate_limits_as_retryable() {
        use reqwest::StatusCode;
        let url = "https://www.instagram.com/reel/example/";
        assert!(classify_fetch_status(url, StatusCode::OK).is_none());
        assert!(matches!(
            classify_fetch_status(url, StatusCode::TOO_MANY_REQUESTS),
            Some(AppError::Network { .. })
        ));
        assert!(matches!(
            classify_fetch_status(url, StatusCode::BAD_GATEWAY),
            Some(AppError::Network { .. })
        ));
        assert!(matches!(
            classify_fetch_status(url, StatusCode::NOT_FOUND),
            Some(AppError::Io { .. })
        ));
        assert!(matches!(
            classify_fetch_status(url, StatusCode::FORBIDDEN),
            Some(AppError::Io { .. })
        ));
    }

    #[test]
    fn only_https_reaches_the_strict_fetches() {
        assert!(require_https("https://example.com/a.json").is_ok());
        assert!(require_https("http://example.com/a.json").is_err());
        assert!(require_https("file:///etc/passwd").is_err());
    }
}
