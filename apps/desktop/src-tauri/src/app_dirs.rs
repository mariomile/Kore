//! Where the app keeps its own files outside any graph, and the one-time move
//! from the folders earlier builds used.
//!
//! Two locations carry the app's name on disk:
//! - the shared config folder `<config dir>/kore` (settings, recent graphs,
//!   the capture-host pointer), shared by every build flavor;
//! - Tauri's per-identifier data folder `<data dir>/<bundle id>` (embedding
//!   model cache, routine marker, isolated Codex home).
//!
//! Earlier builds used `reflect-open` and `app.lore.*` for these. On launch,
//! before anything reads them, [`migrate_legacy`] renames the old folder to
//! the new name when only the old one exists, so an upgrade keeps settings,
//! recents and the model cache. A rename never overwrites: if both exist the
//! new one wins and the old one is left for the user to delete.

// Only the desktop launch runs the folder move; mobile uses `config_dir`.
#![cfg_attr(mobile, allow(dead_code))]

use std::fs;
use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

/// The app's folder under the OS config dir.
const CONFIG_DIR_NAME: &str = "kore";

/// The config folder name earlier builds used.
const LEGACY_CONFIG_DIR_NAME: &str = "reflect-open";

/// The bundle-id prefix earlier builds used, and the one that replaced it.
const LEGACY_ID_PREFIX: &str = "app.lore.";
const ID_PREFIX: &str = "app.kore.";

/// `<config dir>/kore`, the folder `settings.rs`, `recents.rs` and the
/// capture pointer share.
pub fn config_dir() -> AppResult<PathBuf> {
    let base = dirs::config_dir().ok_or_else(|| AppError::io("no OS config dir"))?;
    Ok(base.join(CONFIG_DIR_NAME))
}

/// The identifier an earlier build of this flavor used, if it had one:
/// `app.kore.desktop.beta` → `app.lore.desktop.beta`.
fn legacy_identifier(identifier: &str) -> Option<String> {
    identifier
        .strip_prefix(ID_PREFIX)
        .map(|rest| format!("{LEGACY_ID_PREFIX}{rest}"))
}

/// Rename `from` to `to` when only `from` exists. Returns whether it moved.
fn move_if_only_legacy(from: &Path, to: &Path) -> std::io::Result<bool> {
    if to.exists() || !from.is_dir() {
        return Ok(false);
    }
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::rename(from, to)?;
    Ok(true)
}

/// Move the pre-rename folders into place. Best effort: a failure is logged
/// to stderr and the app starts with fresh folders rather than not at all.
pub fn migrate_legacy(identifier: &str) {
    if let Some(base) = dirs::config_dir() {
        migrate_in(&base, LEGACY_CONFIG_DIR_NAME, CONFIG_DIR_NAME);
    }
    if let (Some(base), Some(legacy)) = (dirs::data_dir(), legacy_identifier(identifier)) {
        migrate_in(&base, &legacy, identifier);
    }
}

fn migrate_in(base: &Path, from: &str, to: &str) {
    if let Err(err) = move_if_only_legacy(&base.join(from), &base.join(to)) {
        eprintln!(
            "kore: could not move {from} to {to} in {}: {err}",
            base.display()
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn moves_the_legacy_folder_when_the_new_one_is_missing() {
        let base = tempfile::tempdir().unwrap();
        fs::create_dir_all(base.path().join("reflect-open")).unwrap();
        fs::write(base.path().join("reflect-open/settings.json"), "{\"a\":1}").unwrap();

        migrate_in(base.path(), "reflect-open", "kore");

        assert!(!base.path().join("reflect-open").exists());
        assert_eq!(
            fs::read_to_string(base.path().join("kore/settings.json")).unwrap(),
            "{\"a\":1}"
        );
    }

    #[test]
    fn never_overwrites_an_existing_new_folder() {
        let base = tempfile::tempdir().unwrap();
        fs::create_dir_all(base.path().join("reflect-open")).unwrap();
        fs::write(base.path().join("reflect-open/settings.json"), "old").unwrap();
        fs::create_dir_all(base.path().join("kore")).unwrap();
        fs::write(base.path().join("kore/settings.json"), "new").unwrap();

        migrate_in(base.path(), "reflect-open", "kore");

        assert_eq!(
            fs::read_to_string(base.path().join("kore/settings.json")).unwrap(),
            "new"
        );
        assert!(base.path().join("reflect-open/settings.json").exists());
    }

    #[test]
    fn nothing_to_move_is_a_no_op() {
        let base = tempfile::tempdir().unwrap();
        migrate_in(base.path(), "app.lore.desktop", "app.kore.desktop");
        assert!(!base.path().join("app.kore.desktop").exists());
    }
}
