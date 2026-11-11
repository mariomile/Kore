//! The app's per-user directory under the OS config dir: settings, recent
//! graphs and the capture pointer (never inside a graph, because they follow
//! the user across graphs). Builds before the Kore rename kept them in
//! `reflect-open/`; the first lookup in a process moves that directory to
//! `kore/` without overwriting anything, so an update keeps every setting.

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
}
