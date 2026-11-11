//! The app's per-user directory under the OS config dir: settings, recent
//! graphs and the capture pointer (never inside a graph, because they follow
//! the user across graphs). Builds before the Kore rename kept them in
//! `reflect-open/`; the first lookup in a process moves that directory to
//! `kore/` without overwriting anything, so an update keeps every setting.
//!
//! Tauri's per-identifier data folder (`<data dir>/<bundle id>`: embedding
//! model cache, routine marker, isolated Codex home) moved the same way when
//! the bundle ids went from `app.lore.*` to `app.kore.*`; see
//! [`migrate_legacy_data_dir`].

use std::path::{Path, PathBuf};
use std::sync::Once;

use kore_index_schema::move_dir_without_overwrite;

use crate::error::{AppError, AppResult};

const APP_DIR: &str = "kore";
const LEGACY_APP_DIR: &str = "reflect-open";

/// `<config_dir>/kore`, after moving the legacy directory once per process.
pub(crate) fn app_config_dir() -> AppResult<PathBuf> {
    static MIGRATE: Once = Once::new();
    let base = dirs::config_dir().ok_or_else(|| AppError::io("no OS config dir"))?;
    MIGRATE.call_once(|| migrate(&base));
    Ok(base.join(APP_DIR))
}

/// Best effort: a failed move leaves the old directory in place, the app
/// starts with defaults, and the move is retried on the next launch.
fn migrate(base: &Path) {
    if let Err(error) = move_dir_without_overwrite(&base.join(LEGACY_APP_DIR), &base.join(APP_DIR))
    {
        tracing::warn!(%error, "could not move the legacy app config directory");
    }
}

/// The bundle-id prefix earlier builds used, and the one that replaced it.
#[cfg_attr(mobile, allow(dead_code))]
const LEGACY_ID_PREFIX: &str = "app.lore.";
#[cfg_attr(mobile, allow(dead_code))]
const ID_PREFIX: &str = "app.kore.";

/// The identifier an earlier build of this flavor used, if it had one:
/// `app.kore.desktop.beta` → `app.lore.desktop.beta`.
#[cfg_attr(mobile, allow(dead_code))]
fn legacy_identifier(identifier: &str) -> Option<String> {
    identifier
        .strip_prefix(ID_PREFIX)
        .map(|rest| format!("{LEGACY_ID_PREFIX}{rest}"))
}

/// Move `<data dir>/app.lore.<flavor>` into `<data dir>/<identifier>` without
/// overwriting anything. Runs once at launch, before any plugin or command
/// resolves `app_data_dir`. Best effort, like [`migrate`].
#[cfg_attr(mobile, allow(dead_code))]
pub(crate) fn migrate_legacy_data_dir(identifier: &str) {
    if let (Some(base), Some(legacy)) = (dirs::data_dir(), legacy_identifier(identifier)) {
        migrate_data_dir_in(&base, &legacy, identifier);
    }
}

#[cfg_attr(mobile, allow(dead_code))]
fn migrate_data_dir_in(base: &Path, legacy: &str, identifier: &str) {
    if let Err(error) = move_dir_without_overwrite(&base.join(legacy), &base.join(identifier)) {
        tracing::warn!(%error, "could not move the legacy app data directory");
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    #[test]
    fn moves_the_legacy_directory_and_keeps_newer_files() {
        let base = tempfile::tempdir().unwrap();
        let legacy = base.path().join(LEGACY_APP_DIR);
        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join("settings.json"), "{\"old\":true}").unwrap();
        fs::write(legacy.join("recent-graphs.json"), "[]").unwrap();
        fs::create_dir_all(base.path().join(APP_DIR)).unwrap();
        fs::write(base.path().join(APP_DIR).join("settings.json"), "{}").unwrap();

        migrate(base.path());

        let current = base.path().join(APP_DIR);
        assert_eq!(
            fs::read_to_string(current.join("settings.json")).unwrap(),
            "{}"
        );
        assert_eq!(
            fs::read_to_string(current.join("recent-graphs.json")).unwrap(),
            "[]"
        );
        assert!(legacy.join("settings.json").is_file());
        assert!(!legacy.join("recent-graphs.json").exists());
    }

    #[test]
    fn legacy_identifier_maps_each_flavor() {
        assert_eq!(
            legacy_identifier("app.kore.desktop").as_deref(),
            Some("app.lore.desktop")
        );
        assert_eq!(
            legacy_identifier("app.kore.desktop.beta").as_deref(),
            Some("app.lore.desktop.beta")
        );
        assert_eq!(legacy_identifier("com.example.other"), None);
    }

    #[test]
    fn moves_the_legacy_data_directory() {
        let base = tempfile::tempdir().unwrap();
        let legacy = base.path().join("app.lore.desktop").join("models");
        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join("model.onnx"), "weights").unwrap();

        migrate_data_dir_in(base.path(), "app.lore.desktop", "app.kore.desktop");

        assert_eq!(
            fs::read_to_string(base.path().join("app.kore.desktop/models/model.onnx")).unwrap(),
            "weights"
        );
    }
}
