//! The graph's runtime directory (`.kore/`) and the one-time move from the
//! name it had before the fork's rename (`.reflect/`).
//!
//! Everything under it is local to the machine (index, caches, trash,
//! conflict archive, capture inbox, agent journal) except [`SYNCED_SUBDIR`],
//! whose proposals travel with the vault's git history (Plan 33, A2).

use std::fs;
use std::io;
use std::path::Path;

/// Directory inside a graph that holds the index (and marks a dir as a graph).
pub const KORE_DIR: &str = ".kore";

/// The runtime directory's name before the rename; migrated by
/// [`migrate_legacy_dir`], still recognised as a graph marker until then.
pub const LEGACY_DIR: &str = ".reflect";

/// The one subdirectory of [`KORE_DIR`] that is committed and synced.
pub const SYNCED_SUBDIR: &str = "proposals";

/// Root-level ignore rules for the runtime directory: everything in it except
/// [`SYNCED_SUBDIR`]. A bare `/.kore/` would exclude the whole directory, and
/// git never re-includes a path under an excluded directory.
pub const IGNORE_RULES: [&str; 2] = ["/.kore/*", "!/.kore/proposals/"];

/// Contents of `.kore/.gitignore`, which makes the directory self-ignoring in
/// any repository that contains the vault, proposals excepted.
pub const SELF_GITIGNORE: &str = "*\n!/proposals/\n!/proposals/**\n";

/// What `.reflect/.gitignore` held before proposals were synced; rewritten to
/// [`SELF_GITIGNORE`] when found.
pub const LEGACY_SELF_GITIGNORE: &str = "*\n";

/// Whether `root` holds a runtime directory under either name.
pub fn has_runtime_dir(root: &Path) -> bool {
    is_real_dir(&root.join(KORE_DIR)) || is_real_dir(&root.join(LEGACY_DIR))
}

/// Move `<root>/.reflect/` to `<root>/.kore/`. A single rename when only the
/// old directory exists, so trash, conflict archive, attachments and journal
/// come along untouched. When both exist (a newer writer created `.kore/`
/// first), old entries move across wherever the name is free, directories
/// on both sides are combined, and the old directory is removed once empty:
/// nothing is ever overwritten or deleted. Symlinks are never followed.
pub fn migrate_legacy_dir(root: &Path) -> io::Result<()> {
    let legacy = root.join(LEGACY_DIR);
    move_dir_without_overwrite(&legacy, &root.join(KORE_DIR))
}

/// Move the directory `from` to `into` with the same rules as
/// [`migrate_legacy_dir`]: a single rename when `into` is absent, otherwise a
/// merge that never overwrites. For other directories renamed with the fork
/// (the app's per-user config directory).
pub fn move_dir_without_overwrite(from: &Path, into: &Path) -> io::Result<()> {
    if !is_real_dir(from) {
        return Ok(());
    }
    match fs::symlink_metadata(into) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => fs::rename(from, into),
        Err(error) => Err(error),
        Ok(metadata) if !metadata.file_type().is_dir() => Ok(()),
        Ok(_) => merge_into(from, into),
    }
}

/// Move each entry of `from` into `into` where the name is free, descending
/// into directories present on both sides (so a capture inbox or trash that
/// both names hold is combined, not stranded). Clashing files stay in
/// `from`, which is removed only once empty.
fn merge_into(from: &Path, into: &Path) -> io::Result<()> {
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = into.join(entry.file_name());
        match fs::symlink_metadata(&target) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                fs::rename(entry.path(), target)?;
            }
            Err(error) => return Err(error),
            Ok(metadata) if metadata.file_type().is_dir() && is_real_dir(&entry.path()) => {
                merge_into(&entry.path(), &target)?;
            }
            Ok(_) => {}
        }
    }
    // Fails (and is ignored) while clashing leftovers remain.
    let _ = fs::remove_dir(from);
    Ok(())
}

fn is_real_dir(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|metadata| metadata.file_type().is_dir())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renames_the_legacy_directory_with_its_contents() {
        let graph = tempfile::tempdir().unwrap();
        let legacy = graph.path().join(LEGACY_DIR);
        fs::create_dir_all(legacy.join("trash")).unwrap();
        fs::write(legacy.join("agent-writes.jsonl"), "{}\n").unwrap();
        fs::write(legacy.join("trash/note.md"), "kept").unwrap();

        migrate_legacy_dir(graph.path()).unwrap();

        let current = graph.path().join(KORE_DIR);
        assert!(!legacy.exists());
        assert_eq!(
            fs::read_to_string(current.join("trash/note.md")).unwrap(),
            "kept"
        );
        assert!(current.join("agent-writes.jsonl").is_file());
        assert!(has_runtime_dir(graph.path()));
    }

    #[test]
    fn merges_into_an_existing_kore_directory_without_overwriting() {
        let graph = tempfile::tempdir().unwrap();
        let legacy = graph.path().join(LEGACY_DIR);
        let current = graph.path().join(KORE_DIR);
        fs::create_dir_all(&legacy).unwrap();
        fs::create_dir_all(current.join(SYNCED_SUBDIR)).unwrap();
        fs::write(legacy.join("index.sqlite"), "old").unwrap();
        fs::write(legacy.join("meta.json"), "old").unwrap();
        fs::write(current.join("meta.json"), "new").unwrap();
        fs::create_dir_all(legacy.join("inbox")).unwrap();
        fs::create_dir_all(current.join("inbox")).unwrap();
        fs::write(legacy.join("inbox/a.json"), "pending").unwrap();
        fs::write(current.join("inbox/b.json"), "pending").unwrap();

        migrate_legacy_dir(graph.path()).unwrap();

        assert_eq!(
            fs::read_to_string(current.join("index.sqlite")).unwrap(),
            "old"
        );
        assert_eq!(
            fs::read_to_string(current.join("meta.json")).unwrap(),
            "new"
        );
        assert_eq!(fs::read_to_string(legacy.join("meta.json")).unwrap(), "old");
        assert!(current.join(SYNCED_SUBDIR).is_dir());
        assert!(current.join("inbox/a.json").is_file());
        assert!(current.join("inbox/b.json").is_file());
        assert!(!legacy.join("inbox").exists());
    }
}
