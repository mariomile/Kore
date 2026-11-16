//! Workspace layout store: the per-graph columns, panes and tabs the main
//! window restores at launch, in its own JSON document next to the settings.
//!
//! It is session state, not a preference: it changes on every navigation,
//! while settings change when the user edits one. Keeping it out of the
//! settings document means a navigation never rewrites the preferences (or
//! re-runs the shortcut and window-chrome sync a settings save triggers).
//! Like settings, Rust treats the document as an opaque JSON object; the shape
//! is `@kore/core`'s zod schema.

use std::path::PathBuf;

use crate::error::AppResult;
use crate::settings::{load_from, save_to, SettingsDoc};

fn store_path() -> AppResult<PathBuf> {
    Ok(crate::app_dir::app_config_dir()?.join("workspace-layout.json"))
}

/// Command: the persisted layout document (an empty object on first run).
/// A corrupt store is an error, as with settings, so a later save can't wipe it.
#[tauri::command]
pub async fn workspace_layout_load() -> AppResult<SettingsDoc> {
    crate::blocking::run_blocking(|| load_from(&store_path()?)).await
}

/// Command: atomically replace the persisted layout document.
#[tauri::command]
pub async fn workspace_layout_save(layout: SettingsDoc) -> AppResult<()> {
    crate::blocking::run_blocking(move || save_to(&store_path()?, &layout)).await
}
