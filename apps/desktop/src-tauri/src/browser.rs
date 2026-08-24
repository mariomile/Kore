//! The embedded in-app browser: one child webview docked inside the main
//! window (a browser tab or the context rail hosts it), instead of a separate
//! browser window.
//!
//! The frontend owns the layout: it renders a host element where the page
//! should appear and mirrors that element's rectangle here (logical CSS
//! pixels, the same unit Tauri's `Logical*` types use). The child webview
//! survives host unmounts hidden, so switching routes never reloads the page —
//! the same lifetime rule as the terminal's PTY.
//!
//! Security matches the old browser window: the `embedded-browser` label is
//! granted by no capability file and Tauri never injects the invoke bridge
//! into remote URLs, so page content cannot reach the graph. Navigation is
//! clamped to http(s) — any other scheme is dropped rather than followed.

use serde::Serialize;
use tauri::webview::WebviewBuilder;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Webview, WebviewUrl};

use crate::error::{AppError, AppResult};
use crate::windows::parse_browser_url;

/// The child webview's label. Must stay out of every capability grant.
const EMBED_LABEL: &str = "embedded-browser";

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
#[tauri::command]
pub async fn browser_embed_show(
    window: tauri::WebviewWindow,
    app: AppHandle,
    url: Option<String>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> AppResult<()> {
    let target = url.as_deref().map(parse_browser_url).transpose()?;
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
        return Ok(());
    }

    let parsed = match target {
        Some(parsed) => parsed,
        None => return Err(AppError::parse("the embedded browser needs a first URL")),
    };
    let handle = app.clone();
    let builder = WebviewBuilder::new(EMBED_LABEL, WebviewUrl::External(parsed))
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
        .map_err(|err| AppError::io(format!("failed to embed the browser webview: {err}")))?;
    Ok(())
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

/// Hide the embedded browser when its host unmounts, keeping the page alive
/// for the next mount. Idempotent.
#[tauri::command]
pub fn browser_embed_hide(app: AppHandle) -> AppResult<()> {
    if let Some(webview) = embed(&app) {
        webview
            .hide()
            .map_err(|err| AppError::io(format!("failed to hide the embedded browser: {err}")))?;
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
