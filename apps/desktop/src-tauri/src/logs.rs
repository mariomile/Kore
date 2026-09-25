//! Local diagnostic logs: a daily-rotated file in the OS log directory
//! (`~/Library/Logs/<bundle id>/` on macOS) that a user can attach to a bug
//! report. Nothing leaves the machine.
//!
//! Rust `tracing` events go to stderr and to the file. The webview's
//! `console.warn` / `console.error` and uncaught errors reach the same file
//! through [`log_webview`], under the `webview` target.
//!
//! Lines may name note files, which are their titles, and URLs; they must
//! never carry note bodies, chat text or credentials.

use std::path::Path;

use serde::Deserialize;
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Manager, Runtime};
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{fmt, EnvFilter};

use crate::error::{AppError, AppResult};

/// Days of log files kept; older ones are deleted on rotation.
const KEPT_LOG_FILES: usize = 7;

/// Install the `tracing` subscriber once the app can resolve its log
/// directory. A plugin rather than an app `setup` hook, so it composes with
/// the app's own setup hooks instead of replacing them.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("kore-logs")
        .setup(|app, _api| {
            let file = match app.path().app_log_dir() {
                Ok(dir) => file_writer(&dir).map_err(|err| err.to_string()),
                Err(err) => Err(err.to_string()),
            };
            match file {
                Ok(writer) => install_subscriber(Some(writer)),
                Err(err) => {
                    install_subscriber(None);
                    tracing::warn!(error = %err, "file logging unavailable; logging to stderr only");
                }
            }
            Ok(())
        })
        .build()
}

/// The daily-rotated writer, `kore.<date>.log` under `dir`.
fn file_writer(dir: &Path) -> Result<RollingFileAppender, tracing_appender::rolling::InitError> {
    RollingFileAppender::builder()
        .rotation(Rotation::DAILY)
        .filename_prefix("kore")
        .filename_suffix("log")
        .max_log_files(KEPT_LOG_FILES)
        .build(dir)
}

/// Honors `RUST_LOG` (default `info`). `try_init`, so a second call (tests,
/// mobile re-entry) is a no-op rather than a panic.
fn install_subscriber(file: Option<RollingFileAppender>) {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let file_layer = file.map(|writer| fmt::layer().with_writer(writer).with_ansi(false));
    let _ = tracing_subscriber::registry()
        .with(filter)
        .with(fmt::layer())
        .with(file_layer)
        .try_init();
}

/// Severity of a forwarded webview message.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WebviewLogLevel {
    Warn,
    Error,
}

/// Command: record one webview console message in the log, tagged with the
/// window it came from (main, a note window, Quick Entry). Async so the file
/// write happens off the main thread.
#[tauri::command]
pub async fn log_webview(level: WebviewLogLevel, message: String, window: tauri::Window) {
    let window = window.label();
    match level {
        WebviewLogLevel::Warn => tracing::warn!(target: "webview", window, "{message}"),
        WebviewLogLevel::Error => tracing::error!(target: "webview", window, "{message}"),
    }
}

/// Command: open the log directory in the OS file manager.
#[tauri::command]
pub async fn logs_reveal(app: tauri::AppHandle) -> AppResult<()> {
    let dir = app
        .path()
        .app_log_dir()
        .map_err(|err| AppError::io(err.to_string()))?;
    crate::blocking::run_blocking(move || open_directory(&app, &dir)).await
}

#[cfg(target_os = "ios")]
fn open_directory(_app: &tauri::AppHandle, _dir: &Path) -> AppResult<()> {
    Err(AppError::io(
        "opening the log folder is not supported on iOS",
    ))
}

#[cfg(not(target_os = "ios"))]
fn open_directory(app: &tauri::AppHandle, dir: &Path) -> AppResult<()> {
    use tauri_plugin_opener::OpenerExt;
    std::fs::create_dir_all(dir)?;
    app.opener()
        .open_path(dir.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|err| AppError::io(err.to_string()))
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use super::file_writer;

    #[test]
    fn file_writer_creates_a_dated_kore_log_in_the_directory() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut writer = file_writer(dir.path()).expect("writer");
        writer.write_all(b"hello log\n").expect("write");
        writer.flush().expect("flush");

        let names: Vec<String> = std::fs::read_dir(dir.path())
            .expect("read dir")
            .map(|entry| {
                entry
                    .expect("entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        assert_eq!(names.len(), 1, "{names:?}");
        let name = &names[0];
        assert!(
            name.starts_with("kore.") && name.ends_with(".log"),
            "{name}"
        );
        let contents = std::fs::read_to_string(dir.path().join(name)).expect("read log");
        assert_eq!(contents, "hello log\n");
    }
}
