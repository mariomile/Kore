//! The embedded in-app browser: one child webview docked inside the main
//! window (a browser tab or the context rail hosts it), instead of a separate
//! browser window.
//!
//! The frontend owns the layout: it renders a host element where the page
//! should appear and mirrors that element's rectangle here (logical CSS
//! pixels, the same unit Tauri's `Logical*` types use). The child webview is
//! closed with its last host so a remote page cannot keep consuming resources
//! after the user leaves the browser; its URL is restored on the next mount.
//!
//! Security matches the old browser window: the `embedded-browser` label is
//! granted by no capability file and Tauri never injects the invoke bridge
//! into remote URLs, so page content cannot reach the graph. Navigation is
//! clamped to http(s) — any other scheme is dropped rather than followed.
//!
//! The AI chat drives the same webview: `browser_embed_open` opens a page
//! even with no pane mounted (created off-screen and hidden), and
//! `browser_embed_read` waits for the document and extracts its visible text
//! for the model. Background-only pages close after that read; a page hosted
//! in a visible Browser pane remains available to both user and agent.

use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::webview::WebviewBuilder;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, State, Webview, WebviewUrl,
};

use crate::error::{AppError, AppResult};
use crate::windows::parse_browser_url;

/// The child webview's label. Must stay out of every capability grant.
const EMBED_LABEL: &str = "embedded-browser";

#[derive(Default)]
struct BrowserLifecycle {
    is_hosted: bool,
    is_closing: bool,
    active_reads: u32,
}

impl BrowserLifecycle {
    fn begin_read(&mut self) -> AppResult<()> {
        if self.active_reads > 0 {
            return Err(AppError::unknown("a browser read is already in progress"));
        }
        self.active_reads = 1;
        Ok(())
    }

    fn finish_read(&mut self) -> AppResult<()> {
        self.active_reads = self
            .active_reads
            .checked_sub(1)
            .ok_or_else(|| AppError::unknown("browser read lease underflow"))?;
        Ok(())
    }

    fn can_close(&self) -> bool {
        !self.is_hosted && !self.is_closing && self.active_reads == 0
    }
}

#[derive(Default)]
pub struct BrowserState {
    lifecycle: Mutex<BrowserLifecycle>,
}

fn lock_lifecycle(state: &BrowserState) -> AppResult<std::sync::MutexGuard<'_, BrowserLifecycle>> {
    state
        .lifecycle
        .lock()
        .map_err(|_| AppError::unknown("browser state lock poisoned"))
}

fn queue_close(webview: &Webview, lifecycle: &mut BrowserLifecycle) -> AppResult<()> {
    lifecycle.is_closing = true;
    if let Err(error) = webview.close() {
        lifecycle.is_closing = false;
        return Err(AppError::io(format!(
            "failed to close the embedded browser: {error}"
        )));
    }
    Ok(())
}

async fn wait_for_close(app: &AppHandle, state: &BrowserState) -> AppResult<()> {
    const CLOSE_POLL_ATTEMPTS: u32 = 40;
    const CLOSE_POLL_MS: u64 = 25;

    for attempt in 0..CLOSE_POLL_ATTEMPTS {
        {
            let mut lifecycle = lock_lifecycle(state)?;
            if !lifecycle.is_closing {
                return Ok(());
            }
            if embed(app).is_none() {
                lifecycle.is_closing = false;
                return Ok(());
            }
        }
        if attempt + 1 < CLOSE_POLL_ATTEMPTS {
            tokio::time::sleep(Duration::from_millis(CLOSE_POLL_MS)).await;
        }
    }
    let mut lifecycle = lock_lifecycle(state)?;
    recover_stalled_close(&mut lifecycle, embed(app).is_some())
}

/// Always drop `is_closing` after the poll budget. A timeout that left the
/// latch set made every later show/open/read wait forever.
fn recover_stalled_close(lifecycle: &mut BrowserLifecycle, webview_present: bool) -> AppResult<()> {
    lifecycle.is_closing = false;
    if webview_present {
        tracing::warn!("the embedded browser did not finish closing; clearing the close latch");
        Err(AppError::unknown(
            "the embedded browser did not finish closing",
        ))
    } else {
        Ok(())
    }
}

/// Emitted to the main webview whenever the page navigates (link clicks,
/// redirects, the frontend's own `browser_embed_navigate`).
const NAVIGATED_EVENT: &str = "browser:navigated";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserNavigatedPayload {
    url: String,
}

fn embed(app: &AppHandle) -> Option<Webview> {
    app.get_webview(EMBED_LABEL)
}

fn place(webview: &Webview, x: f64, y: f64, width: f64, height: f64) -> AppResult<()> {
    webview
        .set_position(LogicalPosition::new(x, y))
        .and_then(|()| webview.set_size(LogicalSize::new(width.max(1.0), height.max(1.0))))
        .map_err(|err| AppError::io(format!("failed to place the embedded browser: {err}")))
}

/// Show the embedded browser over the host rectangle, creating the child
/// webview on first use. `url` navigates an existing webview only when it
/// differs from the current page, so re-showing the pane never reloads.
// The command keeps rectangle fields flat to match browserEmbedShow's IPC
// payload instead of adding a nested transport-only object.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn browser_embed_show(
    window: tauri::WebviewWindow,
    app: AppHandle,
    state: State<'_, BrowserState>,
    url: Option<String>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> AppResult<()> {
    let target = url.as_deref().map(parse_browser_url).transpose()?;
    wait_for_close(&app, &state).await?;
    let mut lifecycle = lock_lifecycle(&state)?;
    if let Some(existing) = embed(&app) {
        if let Some(parsed) = target {
            if existing.url().ok().as_ref() != Some(&parsed) {
                existing
                    .navigate(parsed)
                    .map_err(|err| AppError::io(format!("failed to navigate: {err}")))?;
            }
        }
        place(&existing, x, y, width, height)?;
        existing
            .show()
            .map_err(|err| AppError::io(format!("failed to show the embedded browser: {err}")))?;
        lifecycle.is_hosted = true;
        return Ok(());
    }

    let parsed = match target {
        Some(parsed) => parsed,
        None => return Err(AppError::parse("the embedded browser needs a first URL")),
    };
    create_embed(&window, &app, parsed, x, y, width, height)?;
    lifecycle.is_hosted = true;
    Ok(())
}

/// Build the child webview docked on the main window's `Window`.
fn create_embed(
    window: &tauri::WebviewWindow,
    app: &AppHandle,
    url: tauri::Url,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> AppResult<Webview> {
    let handle = app.clone();
    let builder = WebviewBuilder::new(EMBED_LABEL, WebviewUrl::External(url))
        // Web pages only, forever: a page that links to `file:` or a custom
        // app scheme must not have the embedded webview follow it.
        .on_navigation(move |nav| {
            let allowed = matches!(nav.scheme(), "http" | "https");
            if allowed {
                let _ = handle.emit(
                    NAVIGATED_EVENT,
                    BrowserNavigatedPayload {
                        url: nav.to_string(),
                    },
                );
            }
            allowed
        });
    window
        .as_ref()
        .window()
        .add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(width.max(1.0), height.max(1.0)),
        )
        .map_err(|err| AppError::io(format!("failed to embed the browser webview: {err}")))
}

/// Follow the host element as it moves or resizes. No-op when the webview is
/// gone (a race with close never fails the caller).
#[tauri::command]
pub fn browser_embed_bounds(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> AppResult<()> {
    match embed(&app) {
        Some(webview) => place(&webview, x, y, width, height),
        None => Ok(()),
    }
}

/// Release the last visible host, closing immediately unless an AI read is
/// still using the page. Idempotent.
#[tauri::command]
pub fn browser_embed_close(app: AppHandle, state: State<'_, BrowserState>) -> AppResult<()> {
    let mut lifecycle = lock_lifecycle(&state)?;
    lifecycle.is_hosted = false;
    if lifecycle.is_closing {
        return Ok(());
    }
    if let Some(webview) = embed(&app) {
        webview
            .hide()
            .map_err(|err| AppError::io(format!("failed to hide the embedded browser: {err}")))?;
        if lifecycle.can_close() {
            queue_close(&webview, &mut lifecycle)?;
        }
    }
    Ok(())
}

/// Load a new page in the embedded browser. Web URLs only.
#[tauri::command]
pub fn browser_embed_navigate(app: AppHandle, url: String) -> AppResult<()> {
    let parsed = parse_browser_url(&url)?;
    let webview = embed(&app).ok_or_else(|| AppError::not_found("no embedded browser is open"))?;
    webview
        .navigate(parsed)
        .map_err(|err| AppError::io(format!("failed to navigate: {err}")))
}

/// History back — evaluated in the page, matching what a browser chrome does.
#[tauri::command]
pub fn browser_embed_back(app: AppHandle) -> AppResult<()> {
    eval_in_embed(&app, "history.back()")
}

/// History forward.
#[tauri::command]
pub fn browser_embed_forward(app: AppHandle) -> AppResult<()> {
    eval_in_embed(&app, "history.forward()")
}

/// Reload the current page.
#[tauri::command]
pub fn browser_embed_reload(app: AppHandle) -> AppResult<()> {
    let webview = embed(&app).ok_or_else(|| AppError::not_found("no embedded browser is open"))?;
    webview
        .reload()
        .map_err(|err| AppError::io(format!("failed to reload: {err}")))
}

fn eval_in_embed(app: &AppHandle, script: &str) -> AppResult<()> {
    let webview = embed(app).ok_or_else(|| AppError::not_found("no embedded browser is open"))?;
    webview
        .eval(script)
        .map_err(|err| AppError::io(format!("failed to drive the embedded browser: {err}")))
}

/// Where an agent-created webview parks until a pane docks it: off-screen,
/// at a desktop-ish size so pages lay out normally while loading.
const BACKGROUND_X: f64 = -10_000.0;
const BACKGROUND_WIDTH: f64 = 1_200.0;
const BACKGROUND_HEIGHT: f64 = 900.0;

/// Hard ceiling on extracted page text, before the caller's own `max_chars`.
const MAX_TEXT_CHARS: usize = 60_000;

/// One probe's timeout, the poll interval, and the total readiness budget.
const PROBE_TIMEOUT_MS: u64 = 1_500;
const READ_POLL_MS: u64 = 400;
const READ_MAX_ATTEMPTS: u32 = 20;
/// After this many polls a `complete` document is accepted even when its URL
/// differs from the expected one — that's what a redirect looks like.
const READ_GRACE_ATTEMPTS: u32 = 8;

/// Load and extract a page as one lifecycle operation for the AI chat. With no
/// visible host, the webview is created off-screen and released after the read.
#[tauri::command]
pub async fn browser_embed_open(
    window: tauri::WebviewWindow,
    app: AppHandle,
    state: State<'_, BrowserState>,
    url: String,
    max_chars: Option<u32>,
) -> AppResult<BrowserPageRead> {
    let parsed = parse_browser_url(&url)?;
    wait_for_close(&app, &state).await?;
    let webview = {
        let mut lifecycle = lock_lifecycle(&state)?;
        lifecycle.begin_read()?;
        let webview = if let Some(existing) = embed(&app) {
            if let Err(error) = existing
                .navigate(parsed)
                .map_err(|err| AppError::io(format!("failed to navigate: {err}")))
            {
                lifecycle.finish_read()?;
                return Err(error);
            }
            existing
        } else {
            match create_embed(
                &window,
                &app,
                parsed,
                BACKGROUND_X,
                0.0,
                BACKGROUND_WIDTH,
                BACKGROUND_HEIGHT,
            ) {
                Ok(webview) => {
                    if let Err(error) = webview.hide().map_err(|err| {
                        AppError::io(format!("failed to hide the background browser: {err}"))
                    }) {
                        lifecycle.finish_read()?;
                        queue_close(&webview, &mut lifecycle)?;
                        return Err(error);
                    }
                    webview
                }
                Err(error) => {
                    lifecycle.finish_read()?;
                    return Err(error);
                }
            }
        };
        webview
    };

    let result = read_page(&webview, Some(url), max_chars).await;
    finish_browser_read(&state, &webview, result)
}

/// What one in-page probe reports (serialized by the webview to JSON).
#[derive(Deserialize)]
struct PageProbe {
    url: String,
    title: String,
    ready: String,
    text: String,
    truncated: bool,
}

/// The page text handed to the AI tools.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserPageRead {
    pub url: String,
    pub title: String,
    pub text: String,
    pub truncated: bool,
}

/// Evaluate the extraction snippet in the page and await its JSON answer.
async fn probe_page(webview: &Webview) -> AppResult<PageProbe> {
    let (sender, receiver) = tokio::sync::oneshot::channel::<String>();
    let slot = Mutex::new(Some(sender));
    let script = format!(
        "(() => {{ const body = document.body; const text = body ? body.innerText : ''; \
         return {{ url: location.href, title: document.title, ready: document.readyState, \
         text: text.slice(0, {MAX_TEXT_CHARS}), truncated: text.length > {MAX_TEXT_CHARS} }}; }})()"
    );
    webview
        .eval_with_callback(script, move |json| {
            if let Some(sender) = slot.lock().unwrap().take() {
                let _ = sender.send(json);
            }
        })
        .map_err(|err| AppError::io(format!("failed to read the embedded browser: {err}")))?;
    let json = tokio::time::timeout(Duration::from_millis(PROBE_TIMEOUT_MS), receiver)
        .await
        .map_err(|_| AppError::unknown("the page did not answer in time"))?
        .map_err(|_| AppError::unknown("the page probe was dropped"))?;
    serde_json::from_str(&json)
        .map_err(|err| AppError::parse(format!("unreadable page probe: {err}")))
}

/// Structural URL equality for the readiness check — a trailing slash is not
/// a different page.
fn urls_match(current: &str, expected: &str) -> bool {
    current.trim_end_matches('/') == expected.trim_end_matches('/')
}

async fn read_page(
    webview: &Webview,
    expect_url: Option<String>,
    max_chars: Option<u32>,
) -> AppResult<BrowserPageRead> {
    let mut last: Option<PageProbe> = None;
    for attempt in 0..READ_MAX_ATTEMPTS {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(READ_POLL_MS)).await;
        }
        let Ok(probe) = probe_page(webview).await else {
            // A page mid-navigation can swallow a probe; the next poll asks
            // the new document.
            continue;
        };
        let ready = probe.ready == "complete";
        let matches = match expect_url.as_deref() {
            None => true,
            Some(expected) => urls_match(&probe.url, expected),
        };
        let settled = ready && (matches || attempt >= READ_GRACE_ATTEMPTS);
        last = Some(probe);
        if settled {
            break;
        }
    }
    let probe = last.ok_or_else(|| AppError::unknown("the page did not answer in time"))?;
    let cap = max_chars.map_or(MAX_TEXT_CHARS, |max| (max as usize).min(MAX_TEXT_CHARS));
    let capped: String = probe.text.chars().take(cap).collect();
    let truncated = probe.truncated || capped.chars().count() < probe.text.chars().count();
    Ok(BrowserPageRead {
        url: probe.url,
        title: probe.title,
        text: capped,
        truncated,
    })
}

fn finish_browser_read(
    state: &BrowserState,
    webview: &Webview,
    result: AppResult<BrowserPageRead>,
) -> AppResult<BrowserPageRead> {
    let mut lifecycle = lock_lifecycle(state)?;
    complete_read(&mut lifecycle, result, |lifecycle| {
        queue_close(webview, lifecycle)
    })
}

/// Close a background page after a read. Keep the extracted payload even if
/// that close fails — losing the page text is worse than a leaked webview
/// the next host release can retry.
fn complete_read<T>(
    lifecycle: &mut BrowserLifecycle,
    result: AppResult<T>,
    close: impl FnOnce(&mut BrowserLifecycle) -> AppResult<()>,
) -> AppResult<T> {
    lifecycle.finish_read()?;
    if lifecycle.can_close() {
        if let Err(error) = close(lifecycle) {
            tracing::warn!(
                error = ?error,
                "failed to close the background browser after a page read"
            );
        }
    }
    result
}

/// Extract the current page's visible text for the AI tools, waiting
/// (bounded) for the document to finish loading. `expect_url` tightens the
/// wait after navigation: until the grace window lapses, a
/// `complete` answer for a *different* URL is treated as the previous page
/// still on screen rather than the requested one. A page created off-screen
/// for an AI tool is closed after the read; a page in a visible Browser host
/// stays open.
#[tauri::command]
pub async fn browser_embed_read(
    app: AppHandle,
    state: State<'_, BrowserState>,
    expect_url: Option<String>,
    max_chars: Option<u32>,
) -> AppResult<BrowserPageRead> {
    wait_for_close(&app, &state).await?;
    let webview = {
        let mut lifecycle = lock_lifecycle(&state)?;
        let webview =
            embed(&app).ok_or_else(|| AppError::not_found("no embedded browser is open"))?;
        lifecycle.begin_read()?;
        webview
    };
    let result = read_page(&webview, expect_url, max_chars).await;
    finish_browser_read(&state, &webview, result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_release_waits_for_active_reads() {
        let mut lifecycle = BrowserLifecycle {
            is_hosted: true,
            is_closing: false,
            active_reads: 0,
        };
        lifecycle.begin_read().unwrap();
        lifecycle.is_hosted = false;

        assert!(!lifecycle.can_close());
        lifecycle.finish_read().unwrap();
        assert!(lifecycle.can_close());
    }

    #[test]
    fn a_closing_webview_cannot_close_twice() {
        let lifecycle = BrowserLifecycle {
            is_closing: true,
            ..BrowserLifecycle::default()
        };

        assert!(!lifecycle.can_close());
    }

    #[test]
    fn a_stalled_close_clears_the_latch_so_later_commands_can_proceed() {
        let mut lifecycle = BrowserLifecycle {
            is_closing: true,
            ..BrowserLifecycle::default()
        };

        let error = recover_stalled_close(&mut lifecycle, true).unwrap_err();
        assert!(
            matches!(
                error,
                AppError::Unknown { message } if message == "the embedded browser did not finish closing"
            ),
            "{error:?}"
        );
        assert!(!lifecycle.is_closing);
        assert!(lifecycle.can_close());
    }

    #[test]
    fn a_stalled_close_that_finished_during_the_last_poll_succeeds() {
        let mut lifecycle = BrowserLifecycle {
            is_closing: true,
            ..BrowserLifecycle::default()
        };

        recover_stalled_close(&mut lifecycle, false).unwrap();
        assert!(!lifecycle.is_closing);
    }

    fn sample_page() -> BrowserPageRead {
        BrowserPageRead {
            url: "https://example.com/".into(),
            title: "Example".into(),
            text: "hello".into(),
            truncated: false,
        }
    }

    #[test]
    fn a_failed_close_does_not_discard_extracted_page_text() {
        let mut lifecycle = BrowserLifecycle {
            is_hosted: false,
            is_closing: false,
            active_reads: 1,
        };

        let page = complete_read(&mut lifecycle, Ok(sample_page()), |_| {
            Err(AppError::unknown("close failed"))
        })
        .expect("page text should survive a close failure");

        assert_eq!(page.text, "hello");
        assert_eq!(lifecycle.active_reads, 0);
        assert!(!lifecycle.is_closing);
    }

    #[test]
    fn a_failed_close_still_surfaces_a_failed_read() {
        let mut lifecycle = BrowserLifecycle {
            is_hosted: false,
            is_closing: false,
            active_reads: 1,
        };

        let error = complete_read(
            &mut lifecycle,
            Err::<BrowserPageRead, _>(AppError::unknown("the page did not answer in time")),
            |_| Err(AppError::unknown("close failed")),
        )
        .unwrap_err();

        assert!(
            matches!(
                error,
                AppError::Unknown { message } if message == "the page did not answer in time"
            ),
            "{error:?}"
        );
        assert_eq!(lifecycle.active_reads, 0);
    }
}
