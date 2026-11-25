//! The `kore-asset://` custom protocol: serves graph `assets/` files to
//! the webview **off the UI thread**.
//!
//! WebKit delivers custom-scheme requests on the main thread and wry invokes
//! the handler inline, so Tauri's built-in synchronous `asset:` protocol
//! froze the app for the duration of every uncached image read. On iOS that
//! was seconds: a first read can also wait for iCloud to materialize a
//! dataless file. This handler does the blocking file IO on the async
//! runtime's blocking pool and responds when the bytes are ready, so a slow
//! read costs the image a pop-in, never the app a freeze.
//!
//! URL shape: `kore-asset://localhost/<generation>/<graph-relative path>`,
//! built by `convertFileSrc(…, 'kore-asset')` in the frontend (which
//! percent-encodes the whole path into one segment). The generation pins the
//! request to the graph session that issued it, exactly like mutating
//! commands — a request racing a graph switch is refused, never resolved
//! against the new graph. The path must live under `assets/` and passes the
//! shared symlink-aware traversal guard before any IO.
//! Passive previews append `?kore-preview=raster`; those responses are
//! served only when byte sniffing identifies PNG, JPEG, GIF, or WebP content,
//! so an SVG renamed with a raster extension cannot load subresources there.
//! A note card's picture also adds `kore-thumb`, and gets a small cached JPEG
//! instead of the original (see `thumbnails.rs`); a PDF's card asks the same
//! way and gets a picture of its first page, never the PDF itself.
//!
//! Every response except a PDF carries [`DOCUMENT_POLICY`]: a file opened as
//! a document (an HTML page, an SVG, XML) runs sandboxed in an opaque origin,
//! with scripts but no requests of its own, wherever it is framed or opened. PDFs
//! are exempt because the webview's PDF plugin does not render sandboxed.
//!
//! A `Range` request (WebKit asks for one before it plays any `<video>` or
//! `<audio>`, and refuses media served without `206`) reads only the bytes
//! asked for, at most [`MAX_RANGE_CHUNK`] at a time, so a long video in the
//! vault streams instead of loading whole into memory per request.
//!
//! The app reads some files as text too (an HTML page's title and source,
//! a file handed to the share sheet). Its own origin is not the scheme's,
//! so a response names that origin in `Access-Control-Allow-Origin`, and
//! only that one: a sandboxed page (origin `null`) and a site open in the
//! in-app browser never get to read a response.

use std::borrow::Cow;

use tauri::http::{header, HeaderValue, Request, Response, StatusCode};
use tauri::utils::mime_type::MimeType;
use tauri::{AppHandle, Manager, Runtime, UriSchemeContext, UriSchemeResponder};

use super::GraphState;

/// The scheme name, shared with the `lib.rs` registration. The frontend and
/// the CSP `img-src` / `frame-src` / `connect-src` grants in
/// `tauri.conf.json` (images, the in-app PDF/HTML viewers, and the files the
/// app reads as text) spell it out literally.
pub(crate) const SCHEME: &str = "kore-asset";
const PREVIEW_RASTER_QUERY: &str = "kore-preview=raster";
const THUMBNAIL_QUERY: &str = "kore-thumb";
/// The most one range response carries when the request leaves the end open
/// (`bytes=N-`, how media elements ask): the player asks again for more.
const MAX_RANGE_CHUNK: u64 = 4 * 1024 * 1024;
/// How many leading bytes the type sniffing of a range response reads.
const SNIFF_LEN: u64 = 512;

/// The origins the app's own pages load from, per platform: custom scheme
/// on Apple and Linux, `tauri.localhost` on Windows and Android.
const APP_ORIGINS: [&str; 3] = [
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
];

/// The Content-Security-Policy of every served document. `sandbox` without
/// `allow-same-origin` gives the page an opaque origin: no cookies, storage,
/// or Tauri IPC (the IPC bridge and its key are injected into the app's main
/// frame only, and IPC from any other origin is refused). Scripts, styles,
/// fonts and media may come from the vault or any HTTPS host, so pages made
/// by AI tools that load a chart or CSS library from a CDN render as their
/// author saw them. `connect-src 'none'` and `form-action 'none'` block the
/// page's own requests (fetch, XHR, WebSocket, beacons, form posts); a
/// resource load can still carry data in its URL, so all a page can ever
/// leak is itself: it cannot read the vault, a note, or another origin.
const DOCUMENT_POLICY: &str = "sandbox allow-scripts; \
default-src 'none'; \
script-src 'unsafe-inline' 'unsafe-eval' kore-asset: http://kore-asset.localhost https: data: blob:; \
style-src 'unsafe-inline' kore-asset: http://kore-asset.localhost https: data:; \
img-src kore-asset: http://kore-asset.localhost https: data: blob:; \
font-src kore-asset: http://kore-asset.localhost https: data:; \
media-src kore-asset: http://kore-asset.localhost https: data: blob:; \
connect-src 'none'; form-action 'none'; base-uri 'none'";

/// Protocol entry point (`register_asynchronous_uri_scheme_protocol`). Runs
/// on the webview's calling thread — on WebKit, the app's main thread — so it
/// only moves the request onto the blocking pool; all IO happens there.
pub(crate) fn handle<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let app = ctx.app_handle().clone();
    // Skip the leading `/`; the remainder is one percent-encoded segment.
    let request_path = percent_encoding::percent_decode(&request.uri().path().as_bytes()[1..])
        .decode_utf8_lossy()
        .into_owned();
    let preview_raster_only = has_query_flag(request.uri().query(), PREVIEW_RASTER_QUERY);
    // A thumbnail is a passive preview too: it never serves anything the
    // raster-only rule would refuse.
    let thumbnail = preview_raster_only && has_query_flag(request.uri().query(), THUMBNAIL_QUERY);
    let method_allowed = request.method() == tauri::http::Method::GET;
    // Passive previews always get the whole (vetted) file; only a plain
    // request can stream.
    let range = (!preview_raster_only)
        .then(|| request.headers().get(header::RANGE))
        .flatten()
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let allow_origin = request
        .headers()
        .get(header::ORIGIN)
        .and_then(|origin| origin.to_str().ok())
        .filter(|origin| is_app_origin(origin, dev_origin(&app).as_deref()))
        .and_then(|origin| HeaderValue::from_str(origin).ok());
    tauri::async_runtime::spawn_blocking(move || {
        if !method_allowed {
            responder.respond(status_response(StatusCode::METHOD_NOT_ALLOWED));
            return;
        }
        let mut response = match range {
            Some(range) => range_response_for(&app, &request_path, &range),
            None => response_for(&app, &request_path, preview_raster_only, thumbnail),
        };
        let headers = response.headers_mut();
        headers.insert(header::VARY, HeaderValue::from_static("Origin"));
        if let Some(origin) = allow_origin {
            headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin);
        }
        responder.respond(response);
    });
}

fn response_for<R: Runtime>(
    app: &AppHandle<R>,
    request_path: &str,
    preview_raster_only: bool,
    thumbnail: bool,
) -> Response<Cow<'static, [u8]>> {
    let served = locate(app, request_path).and_then(|path| {
        // A cached thumbnail answers without touching the original: it was
        // only ever written from a file that passed the check below.
        let cache_file = thumbnail
            .then(|| thumbnail_cache_file(app, &path))
            .flatten();
        if let Some(bytes) = cache_file
            .as_deref()
            .and_then(|file| std::fs::read(file).ok())
        {
            return Ok(("image/jpeg".to_owned(), bytes));
        }
        let (mime, bytes) = read(&path)?;
        // A PDF reaches a passive preview only as the picture of its first
        // page, never as itself.
        let pdf_thumbnail = thumbnail && mime == "application/pdf";
        if preview_raster_only && !pdf_thumbnail && !is_preview_safe_raster_mime(&mime) {
            return Err(StatusCode::UNSUPPORTED_MEDIA_TYPE);
        }
        match cache_file
            .as_deref()
            .and_then(|file| super::thumbnails::thumbnail(file, &mime, &bytes))
        {
            Some(jpeg) => Ok(("image/jpeg".to_owned(), jpeg)),
            None if pdf_thumbnail => Err(StatusCode::UNSUPPORTED_MEDIA_TYPE),
            None => Ok((mime, bytes)),
        }
    });
    match served {
        Ok((mime, bytes)) => {
            let builder = Response::builder()
                .header(header::CONTENT_LENGTH, bytes.len())
                .header(header::ACCEPT_RANGES, "bytes");
            let builder = match document_policy(&mime) {
                Some(policy) => builder.header(header::CONTENT_SECURITY_POLICY, policy),
                None => builder,
            };
            builder
                .header(header::CONTENT_TYPE, mime)
                .body(Cow::Owned(bytes))
                .unwrap_or_else(|_| status_response(StatusCode::INTERNAL_SERVER_ERROR))
        }
        Err(status) => {
            tracing::warn!(path = request_path, %status, "asset protocol refused a request");
            status_response(status)
        }
    }
}

/// A `206` with the bytes `range` names, read straight from the file, or the
/// status that refuses it (`416` for a range past the end).
fn range_response_for<R: Runtime>(
    app: &AppHandle<R>,
    request_path: &str,
    range: &str,
) -> Response<Cow<'static, [u8]>> {
    let served = locate(app, request_path).and_then(|path| read_range(&path, range));
    match served {
        Ok(RangeBody {
            mime,
            start,
            end,
            total,
            bytes,
        }) => {
            let builder = Response::builder()
                .status(StatusCode::PARTIAL_CONTENT)
                .header(header::CONTENT_LENGTH, bytes.len())
                .header(header::ACCEPT_RANGES, "bytes")
                .header(
                    header::CONTENT_RANGE,
                    format!("bytes {start}-{end}/{total}"),
                );
            let builder = match document_policy(&mime) {
                Some(policy) => builder.header(header::CONTENT_SECURITY_POLICY, policy),
                None => builder,
            };
            builder
                .header(header::CONTENT_TYPE, mime)
                .body(Cow::Owned(bytes))
                .unwrap_or_else(|_| status_response(StatusCode::INTERNAL_SERVER_ERROR))
        }
        Err(status) => {
            tracing::warn!(path = request_path, %status, "asset protocol refused a range");
            status_response(status)
        }
    }
}

#[derive(Debug)]
struct RangeBody {
    mime: String,
    start: u64,
    end: u64,
    total: u64,
    bytes: Vec<u8>,
}

/// The bytes `range` names of the file at `path`, with its sniffed type.
fn read_range(path: &std::path::Path, range: &str) -> Result<RangeBody, StatusCode> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(path).map_err(io_status)?;
    let total = file.metadata().map_err(io_status)?.len();
    let (start, end) = parse_range(range, total).ok_or(StatusCode::RANGE_NOT_SATISFIABLE)?;
    let mut head = Vec::new();
    (&mut file)
        .take(SNIFF_LEN)
        .read_to_end(&mut head)
        .map_err(io_status)?;
    let mime = MimeType::parse(&head, &path.to_string_lossy());
    file.seek(SeekFrom::Start(start)).map_err(io_status)?;
    let mut bytes = Vec::new();
    file.take(end - start + 1)
        .read_to_end(&mut bytes)
        .map_err(io_status)?;
    Ok(RangeBody {
        mime,
        start,
        end,
        total,
        bytes,
    })
}

/// The inclusive byte span one `Range` header asks of a `total`-byte file,
/// or None when it cannot be served (malformed, several ranges, or past the
/// end). An open end is capped at [`MAX_RANGE_CHUNK`].
fn parse_range(header: &str, total: u64) -> Option<(u64, u64)> {
    let spec = header.trim().strip_prefix("bytes=")?;
    if spec.contains(',') || total == 0 {
        return None;
    }
    let (first, last) = spec.split_once('-')?;
    let (first, last) = (first.trim(), last.trim());
    let (start, end) = if first.is_empty() {
        let suffix: u64 = last.parse().ok()?;
        if suffix == 0 {
            return None;
        }
        (total.saturating_sub(suffix), total - 1)
    } else {
        let start: u64 = first.parse().ok()?;
        let end = if last.is_empty() {
            start.saturating_add(MAX_RANGE_CHUNK - 1)
        } else {
            last.parse().ok()?
        };
        (start, end.min(total - 1))
    };
    (start <= end && start < total).then_some((start, end))
}

/// The sandbox policy a response of type `mime` carries: every type but PDF.
fn document_policy(mime: &str) -> Option<&'static str> {
    (mime != "application/pdf").then_some(DOCUMENT_POLICY)
}

/// Whether `origin` is one of the app's own pages: its bundled origin, or
/// the dev server it loads from in a debug build.
fn is_app_origin(origin: &str, dev_origin: Option<&str>) -> bool {
    APP_ORIGINS.contains(&origin) || dev_origin == Some(origin)
}

/// The dev server's origin in a debug build, None in a release one.
fn dev_origin<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    if !cfg!(debug_assertions) {
        return None;
    }
    let url = app.config().build.dev_url.as_ref()?;
    Some(url.origin().ascii_serialization())
}

fn has_query_flag(query: Option<&str>, flag: &str) -> bool {
    query.is_some_and(|query| query.split('&').any(|parameter| parameter == flag))
}

/// Where the card thumbnail of `path` is cached, or None without a cache
/// directory (the original is then served as it is).
fn thumbnail_cache_file<R: Runtime>(
    app: &AppHandle<R>,
    path: &std::path::Path,
) -> Option<std::path::PathBuf> {
    let dir = app.path().app_cache_dir().ok()?;
    super::thumbnails::cache_path(&dir.join("thumbnails"), path)
}

fn is_preview_safe_raster_mime(mime: &str) -> bool {
    matches!(
        mime,
        "image/png" | "image/jpeg" | "image/gif" | "image/webp"
    )
}

fn status_response(status: StatusCode) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(status)
        .body(Cow::Borrowed(&[][..]))
        .expect("a status-only response always builds")
}

/// The file a request names, after the generation pin and traversal guard.
fn locate<R: Runtime>(
    app: &AppHandle<R>,
    request_path: &str,
) -> Result<std::path::PathBuf, StatusCode> {
    let (generation, rel) = parse_request_path(request_path)?;
    let state = app.state::<GraphState>();
    let root = super::root_for_generation(&state, generation).map_err(|_| StatusCode::FORBIDDEN)?;
    super::resolve::resolve(&root, rel).map_err(|_| StatusCode::FORBIDDEN)
}

/// The file's bytes and sniffed type.
fn read(path: &std::path::Path) -> Result<(String, Vec<u8>), StatusCode> {
    // On an iCloud graph this read blocks until the file is materialized on
    // the device — acceptable here on the blocking pool, and exactly the wait
    // that must never happen on the UI thread.
    let bytes = std::fs::read(path).map_err(io_status)?;
    let mime = MimeType::parse(&bytes, &path.to_string_lossy());
    Ok((mime, bytes))
}

fn io_status(err: std::io::Error) -> StatusCode {
    match err.kind() {
        std::io::ErrorKind::NotFound => StatusCode::NOT_FOUND,
        std::io::ErrorKind::PermissionDenied => StatusCode::FORBIDDEN,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

/// Split `<generation>/<graph-relative path>` and vet the path shape. Any
/// supported attachment anywhere in the vault qualifies, mirroring
/// `asset_open`: an adopted vault keeps its images beside its notes. Notes,
/// hidden components, and traversal shapes stay forbidden.
fn parse_request_path(request_path: &str) -> Result<(u64, &str), StatusCode> {
    let (generation, rel) = request_path
        .split_once('/')
        .ok_or(StatusCode::BAD_REQUEST)?;
    let generation: u64 = generation.parse().map_err(|_| StatusCode::BAD_REQUEST)?;
    // Chat attachment files are the one carve-out from the "no hidden
    // components" rule: their shape is closed (id segments plus a raster
    // extension, validated below), so nothing else under `.kore/` becomes
    // reachable through it.
    if super::chat_attachments::is_chat_attachment_image_rel(rel) {
        return Ok((generation, rel));
    }
    super::ensure_readable_attachment_path(rel).map_err(|_| StatusCode::FORBIDDEN)?;
    Ok((generation, rel))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_generation_pinned_asset_path() {
        assert_eq!(
            parse_request_path("3/assets/cat.png").unwrap(),
            (3, "assets/cat.png"),
        );
        assert_eq!(
            parse_request_path("12/assets/sub dir/photo 1.jpeg").unwrap(),
            (12, "assets/sub dir/photo 1.jpeg"),
        );
        assert_eq!(
            parse_request_path("3/Projects/Media/cat.png").unwrap(),
            (3, "Projects/Media/cat.png"),
        );
    }

    #[test]
    fn rejects_malformed_requests() {
        assert_eq!(
            parse_request_path("assets/cat.png").unwrap_err(),
            StatusCode::BAD_REQUEST,
        );
        assert_eq!(
            parse_request_path("3").unwrap_err(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            parse_request_path("nope/assets/cat.png").unwrap_err(),
            StatusCode::BAD_REQUEST,
        );
    }

    #[test]
    fn carves_out_chat_attachment_files_and_nothing_else_hidden() {
        assert_eq!(
            parse_request_path("3/.kore/chat-attachments/conv-1/att-2.jpeg").unwrap(),
            (3, ".kore/chat-attachments/conv-1/att-2.jpeg"),
        );
        for path in [
            "3/.kore/chat-attachments/conv-1/att-2.svg",
            "3/.kore/chat-attachments/conv-1/att-2.pdf",
            "3/.kore/chat-attachments/../index.db",
            "3/.kore/chat-attachments/conv-1",
            "3/.kore/index.db",
            "3/.kore/tmp/att.jpeg",
        ] {
            assert_eq!(
                parse_request_path(path).unwrap_err(),
                StatusCode::FORBIDDEN,
                "{path} must stay forbidden"
            );
        }
    }

    #[test]
    fn rejects_notes_hidden_and_traversal_paths() {
        assert_eq!(
            parse_request_path("3/notes/secret.md").unwrap_err(),
            StatusCode::FORBIDDEN,
        );
        assert_eq!(
            parse_request_path("3/.obsidian/cat.png").unwrap_err(),
            StatusCode::FORBIDDEN,
        );
        assert_eq!(
            parse_request_path("3/../cat.png").unwrap_err(),
            StatusCode::FORBIDDEN,
        );
        assert_eq!(
            parse_request_path("3/assets").unwrap_err(),
            StatusCode::FORBIDDEN,
        );
        assert_eq!(
            parse_request_path("3/assets/").unwrap_err(),
            StatusCode::FORBIDDEN,
        );
    }

    #[test]
    fn recognizes_only_the_explicit_preview_raster_query() {
        assert!(has_query_flag(
            Some("kore-preview=raster"),
            PREVIEW_RASTER_QUERY
        ));
        assert!(has_query_flag(
            Some("cache=1&kore-preview=raster"),
            PREVIEW_RASTER_QUERY
        ));
        assert!(!has_query_flag(None, PREVIEW_RASTER_QUERY));
        assert!(!has_query_flag(
            Some("kore-preview=svg"),
            PREVIEW_RASTER_QUERY
        ));
    }

    #[test]
    fn preview_raster_filter_uses_sniffed_content_not_the_filename() {
        let disguised_svg = br#"<svg xmlns="http://www.w3.org/2000/svg"></svg>"#;
        let svg_mime = MimeType::parse(disguised_svg, "assets/disguised.png");
        assert_ne!(svg_mime, "image/png");
        assert!(!is_preview_safe_raster_mime(&svg_mime));

        let png_signature = b"\x89PNG\r\n\x1a\n";
        let png_mime = MimeType::parse(png_signature, "assets/image.bin");
        assert_eq!(png_mime, "image/png");
        assert!(is_preview_safe_raster_mime(&png_mime));
    }

    #[test]
    fn parses_the_ranges_media_elements_ask_for() {
        assert_eq!(parse_range("bytes=0-1", 100), Some((0, 1)));
        assert_eq!(parse_range("bytes=10-", 100), Some((10, 99)));
        assert_eq!(parse_range("bytes=90-200", 100), Some((90, 99)));
        assert_eq!(parse_range("bytes=-30", 100), Some((70, 99)));
        assert_eq!(parse_range("bytes=-300", 100), Some((0, 99)));
        let big = 100 * MAX_RANGE_CHUNK;
        assert_eq!(parse_range("bytes=0-", big), Some((0, MAX_RANGE_CHUNK - 1)));
    }

    #[test]
    fn refuses_ranges_it_cannot_serve() {
        for header in [
            "bytes=100-",
            "bytes=5-2",
            "bytes=-0",
            "bytes=0-1,4-5",
            "items=0-1",
            "bytes=a-b",
            "bytes",
        ] {
            assert_eq!(parse_range(header, 100), None, "{header}");
        }
        assert_eq!(parse_range("bytes=0-", 0), None);
    }

    #[test]
    fn reads_only_the_requested_bytes_with_the_files_type() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("clip.mp4");
        let mut bytes = b"\x00\x00\x00\x18ftypmp42".to_vec();
        bytes.extend((0..1000u32).map(|i| (i % 251) as u8));
        std::fs::write(&path, &bytes).unwrap();
        let body = read_range(&path, "bytes=100-199").unwrap();
        assert_eq!(
            (body.start, body.end, body.total),
            (100, 199, bytes.len() as u64)
        );
        assert_eq!(body.bytes, bytes[100..200]);
        assert_eq!(body.mime, "video/mp4");
        assert_eq!(
            read_range(&path, "bytes=5000-").unwrap_err(),
            StatusCode::RANGE_NOT_SATISFIABLE
        );
    }

    #[test]
    fn only_the_apps_own_origins_may_read_a_response() {
        let dev = Some("http://localhost:1420");
        assert!(is_app_origin("tauri://localhost", None));
        assert!(is_app_origin("http://tauri.localhost", None));
        assert!(is_app_origin("http://localhost:1420", dev));
        assert!(!is_app_origin("http://localhost:1420", None));
        // A sandboxed page, a site in the in-app browser.
        assert!(!is_app_origin("null", dev));
        assert!(!is_app_origin("https://example.com", dev));
        assert!(!is_app_origin("tauri://localhost.example.com", dev));
    }

    #[test]
    fn documents_are_sandboxed_without_network_and_pdfs_are_not() {
        let html_mime = MimeType::parse(b"<!doctype html><script></script>", "Reports/q4.html");
        let policy = document_policy(&html_mime).expect("an HTML page is sandboxed");
        assert!(policy.starts_with("sandbox allow-scripts;"));
        assert!(!policy.contains("allow-same-origin"));
        assert!(policy.contains("connect-src 'none'"));
        assert!(policy.contains("form-action 'none'"));

        let svg_mime = MimeType::parse(
            br#"<svg xmlns="http://www.w3.org/2000/svg"></svg>"#,
            "a.svg",
        );
        assert!(document_policy(&svg_mime).is_some());

        let pdf_mime = MimeType::parse(b"%PDF-1.7", "Reports/q4.pdf");
        assert_eq!(document_policy(&pdf_mime), None);
    }
}
