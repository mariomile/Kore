//! One home for the async-command → blocking-pool hop.
//!
//! Sync Tauri commands run on the main thread — on iOS the thread that also
//! delivers touches — so any command that does real filesystem, SQLite, or
//! git work is declared `async` and runs its body here instead. The
//! `JoinError` arm only fires when the closure panics; the panic itself is
//! the bug, this just keeps it from poisoning the command layer silently.

use crate::error::{AppError, AppResult};

/// Run `task` on the blocking thread pool and await its result.
pub(crate) async fn run_blocking<T, F>(task: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|err| AppError::io(format!("blocking task panicked: {err}")))?
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;
    use std::fs;
    use std::path::Path;

    /// Every `#[tauri::command]` that is still declared `fn` rather than
    /// `async fn`, with the reason it is allowed to be.
    ///
    /// A sync command runs its body on the main thread, which on iOS is the
    /// thread that delivers touches. Some of these are correct and always will
    /// be: AppKit requires window, menu and webview calls on the main thread,
    /// and an unsupported-platform stub does no work at all. The rest are
    /// marked DEBT and should shrink: convert one to `async fn` + `run_blocking`
    /// and delete its row here.
    ///
    /// The reasons are recorded per module, because what justifies staying sync
    /// is a property of what the module touches.
    const SYNC_COMMAND_ALLOWLIST: &[(&str, &str, &str)] = &[
    ("app_platform", "lib.rs", "returns a compile-time constant"),
    ("app_version", "lib.rs", "returns a compile-time constant"),
    ("asset_open", "fs/mod.rs", "DEBT (audit 1.8 and 2.1): filesystem work on the main thread"),
    ("asset_read", "fs/mod.rs", "DEBT (audit 1.8 and 2.1): filesystem work on the main thread"),
    ("asset_read_binary", "fs/mod.rs", "DEBT (audit 1.8 and 2.1): filesystem work on the main thread"),
    ("asset_reveal", "fs/mod.rs", "DEBT (audit 1.8 and 2.1): filesystem work on the main thread"),
    ("asset_upload_abort", "fs/assets.rs", "DEBT (audit 2.3): moves whole asset files on the main thread"),
    ("asset_upload_begin", "fs/assets.rs", "DEBT (audit 2.3): moves whole asset files on the main thread"),
    ("audio_memo_delete", "fs/mod.rs", "DEBT (audit 1.8 and 2.1): filesystem work on the main thread"),
    ("background_task_begin", "background_task.rs", "flips an in-memory counter under a mutex"),
    ("background_task_end", "background_task.rs", "flips an in-memory counter under a mutex"),
    ("browser_embed_back", "browser.rs", "owns webview lifetime and geometry, which AppKit requires on the main thread"),
    ("browser_embed_back", "browser_mobile.rs", "unsupported-platform stub: returns immediately, touches nothing"),
    ("browser_embed_bounds", "browser.rs", "owns webview lifetime and geometry, which AppKit requires on the main thread"),
    ("browser_embed_bounds", "browser_mobile.rs", "unsupported-platform stub: returns immediately, touches nothing"),
    ("browser_embed_close", "browser.rs", "owns webview lifetime and geometry, which AppKit requires on the main thread"),
    ("browser_embed_close", "browser_mobile.rs", "unsupported-platform stub: returns immediately, touches nothing"),
    ("browser_embed_forward", "browser.rs", "owns webview lifetime and geometry, which AppKit requires on the main thread"),
    ("browser_embed_forward", "browser_mobile.rs", "unsupported-platform stub: returns immediately, touches nothing"),
    ("browser_embed_navigate", "browser.rs", "owns webview lifetime and geometry, which AppKit requires on the main thread"),
    ("browser_embed_navigate", "browser_mobile.rs", "unsupported-platform stub: returns immediately, touches nothing"),
    ("browser_embed_open", "browser_mobile.rs", "unsupported-platform stub: returns immediately, touches nothing"),
    ("browser_embed_read", "browser_mobile.rs", "unsupported-platform stub: returns immediately, touches nothing"),
    ("browser_embed_reload", "browser.rs", "owns webview lifetime and geometry, which AppKit requires on the main thread"),
    ("browser_embed_reload", "browser_mobile.rs", "unsupported-platform stub: returns immediately, touches nothing"),
    ("browser_embed_show", "browser_mobile.rs", "unsupported-platform stub: returns immediately, touches nothing"),
    ("calendar_authorization_status", "calendar.rs", "reads the cached EventKit authorization status; the queries themselves are async"),
    ("capture_host_register", "capture.rs", "DEBT (audit 2.4 and 2.1): spools and reads capture files on the main thread"),
    ("capture_inbox_list", "capture.rs", "DEBT (audit 2.4 and 2.1): spools and reads capture files on the main thread"),
    ("capture_inbox_read", "capture.rs", "DEBT (audit 2.4 and 2.1): spools and reads capture files on the main thread"),
    ("capture_inbox_reject", "capture.rs", "DEBT (audit 2.4 and 2.1): spools and reads capture files on the main thread"),
    ("capture_inbox_remove", "capture.rs", "DEBT (audit 2.4 and 2.1): spools and reads capture files on the main thread"),
    ("capture_inbox_spool", "capture.rs", "DEBT (audit 2.4 and 2.1): spools and reads capture files on the main thread"),
    ("dir_list", "fs/mod.rs", "DEBT (audit 1.8 and 2.1): filesystem work on the main thread"),
    ("embed_ensure", "embed_mobile.rs", "unsupported-platform stub: returns immediately, touches nothing"),
    ("embed_status", "embed.rs", "reads cached model status behind a mutex"),
    ("embed_status", "embed_mobile.rs", "unsupported-platform stub: returns immediately, touches nothing"),
    ("embed_texts", "embed_mobile.rs", "unsupported-platform stub: returns immediately, touches nothing"),
    ("export_write", "fs/mod.rs", "DEBT (audit 1.8 and 2.1): filesystem work on the main thread"),
    ("forget_recent", "recents.rs", "reads and writes a small in-memory list behind a mutex"),
    ("graph_create", "fs/mod.rs", "DEBT (audit 1.8 and 2.1): filesystem work on the main thread"),
    ("graph_delete", "fs/mod.rs", "DEBT (audit 1.8 and 2.1): filesystem work on the main thread"),
    ("graph_import_cancel", "fs/mod.rs", "DEBT (audit 1.8 and 2.1): filesystem work on the main thread"),
    ("graph_open", "fs/mod.rs", "DEBT (audit 1.8 and 2.1): filesystem work on the main thread"),
    ("haptic_feedback", "haptics.rs", "fires a native haptic, a UI-thread call that returns immediately"),
    ("icloud_watch_stop", "icloud/watch.rs", "stops a watcher by flipping an atomic; the watcher itself runs off-thread"),
    ("menu_install_paste_and_match_style", "menu.rs", "installs a native menu item, which AppKit requires on the main thread"),
    ("mobile_storage_local", "icloud/storage.rs", "reads a cached container path"),
    ("note_delete", "fs/mod.rs", "DEBT (audit 1.8 and 2.1): filesystem work on the main thread"),
    ("note_exists", "fs/mod.rs", "DEBT (audit 1.8 and 2.1): filesystem work on the main thread"),
    ("pty_ack", "pty.rs", "writes to an already-open PTY handle: a buffered fd write, not a file open"),
    ("pty_ack", "pty_mobile.rs", "unsupported-platform stub: returns immediately, touches nothing"),
    ("pty_close", "pty_mobile.rs", "unsupported-platform stub: returns immediately, touches nothing"),
    ("pty_open", "pty.rs", "writes to an already-open PTY handle: a buffered fd write, not a file open"),
    ("pty_open", "pty_mobile.rs", "unsupported-platform stub: returns immediately, touches nothing"),
    ("pty_resize", "pty.rs", "writes to an already-open PTY handle: a buffered fd write, not a file open"),
    ("pty_resize", "pty_mobile.rs", "unsupported-platform stub: returns immediately, touches nothing"),
    ("pty_write", "pty.rs", "writes to an already-open PTY handle: a buffered fd write, not a file open"),
    ("pty_write", "pty_mobile.rs", "unsupported-platform stub: returns immediately, touches nothing"),
    ("quick_capture_hide", "windows.rs", "window and registry state under a mutex; no filesystem or SQLite work"),
    ("quit_confirm", "quit.rs", "drives the native quit dialog on the main thread"),
    ("recent_graphs", "recents.rs", "reads and writes a small in-memory list behind a mutex"),
    ("settings_load", "settings.rs", "reads and writes one small JSON file in the app config dir"),
    ("settings_save", "settings.rs", "reads and writes one small JSON file in the app config dir"),
    ("skill_install", "skill.rs", "DEBT (audit 2.1): installs and removes skill files on the main thread"),
    ("skill_status", "skill.rs", "DEBT (audit 2.1): installs and removes skill files on the main thread"),
    ("skill_uninstall", "skill.rs", "DEBT (audit 2.1): installs and removes skill files on the main thread"),
    ("toggle_devtools", "devtools.rs", "toggles the webview inspector, a main-thread window operation"),
    ("transcript_cache_read", "fs/mod.rs", "DEBT (audit 1.8 and 2.1): filesystem work on the main thread"),
    ("transcript_cache_write", "fs/mod.rs", "DEBT (audit 1.8 and 2.1): filesystem work on the main thread"),
    ("watch_start", "watcher.rs", "starts and stops the notify watcher; the watch loop itself runs off-thread"),
    ("watch_start", "watcher_mobile.rs", "unsupported-platform stub: returns immediately, touches nothing"),
    ("watch_stop", "watcher.rs", "starts and stops the notify watcher; the watch loop itself runs off-thread"),
    ("watch_stop", "watcher_mobile.rs", "unsupported-platform stub: returns immediately, touches nothing"),
    ("window_bootstrap", "windows.rs", "window and registry state under a mutex; no filesystem or SQLite work"),
    ];

    /// Source-scan for `#[tauri::command]` items, returning `(name, module,
    /// is_async)`. Attribute macros are expanded long before a test runs, so
    /// the declarations are not reachable at runtime: reading the source is
    /// what makes this checkable at all.
    fn declared_commands() -> Vec<(String, String, bool)> {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut found = Vec::new();
        let mut stack = vec![root.clone()];
        while let Some(dir) = stack.pop() {
            for entry in fs::read_dir(&dir).expect("read src dir") {
                let path = entry.expect("dir entry").path();
                if path.is_dir() {
                    stack.push(path);
                    continue;
                }
                if path.extension().and_then(|ext| ext.to_str()) != Some("rs") {
                    continue;
                }
                let module = path
                    .strip_prefix(&root)
                    .expect("path under src")
                    .to_string_lossy()
                    .replace('\\', "/");
                let source = fs::read_to_string(&path).expect("read source");
                let lines: Vec<&str> = source.lines().collect();
                for (index, line) in lines.iter().enumerate() {
                    if !line.trim_start().starts_with("#[tauri::command") {
                        continue;
                    }
                    for candidate in lines.iter().skip(index + 1).take(8) {
                        let trimmed = candidate.trim_start();
                        let without_vis = trimmed
                            .strip_prefix("pub(crate) ")
                            .or_else(|| trimmed.strip_prefix("pub(super) "))
                            .or_else(|| trimmed.strip_prefix("pub "))
                            .unwrap_or(trimmed);
                        let (is_async, rest) = match without_vis.strip_prefix("async ") {
                            Some(rest) => (true, rest),
                            None => (false, without_vis),
                        };
                        if let Some(rest) = rest.strip_prefix("fn ") {
                            let name: String = rest
                                .chars()
                                .take_while(|ch| ch.is_alphanumeric() || *ch == '_')
                                .collect();
                            found.push((name, module.clone(), is_async));
                            break;
                        }
                    }
                }
            }
        }
        found
    }

    /// A sync command is a main-thread command. New ones must be a deliberate
    /// choice with a stated reason, not something that slips in because `fn` is
    /// what one types by default.
    #[test]
    fn every_sync_command_is_on_the_allowlist() {
        let allowed: BTreeSet<(&str, &str)> = SYNC_COMMAND_ALLOWLIST
            .iter()
            .map(|(name, module, _)| (*name, *module))
            .collect();
        let mut unlisted: Vec<String> = declared_commands()
            .into_iter()
            .filter(|(_, _, is_async)| !is_async)
            .filter(|(name, module, _)| !allowed.contains(&(name.as_str(), module.as_str())))
            .map(|(name, module, _)| format!("{module}::{name}"))
            .collect();
        unlisted.sort();
        assert!(
            unlisted.is_empty(),
            "these commands run on the main thread with no recorded reason.\n\
             Declare them `async fn` and run the body through `run_blocking`, or\n\
             add them to SYNC_COMMAND_ALLOWLIST with the reason they must stay sync:\n  {}",
            unlisted.join("\n  ")
        );
    }

    /// The allowlist only shrinks. An entry left behind after its command went
    /// async reads as debt that is still owed, and hides the progress made.
    #[test]
    fn the_allowlist_has_no_stale_entries() {
        let declared = declared_commands();
        let mut stale = Vec::new();
        for (name, module, _) in SYNC_COMMAND_ALLOWLIST {
            match declared
                .iter()
                .find(|(found, found_module, _)| found == name && found_module == module)
            {
                None => stale.push(format!("{module}::{name} (no such command)")),
                Some((_, _, true)) => stale.push(format!("{module}::{name} (now async)")),
                Some(_) => {}
            }
        }
        assert!(
            stale.is_empty(),
            "remove these from SYNC_COMMAND_ALLOWLIST:\n  {}",
            stale.join("\n  ")
        );
    }
}
