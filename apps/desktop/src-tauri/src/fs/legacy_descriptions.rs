//! One-time rename of asset descriptions from their pre-rename name.
//!
//! Plan 20 stores an asset's AI description beside it under `assets/`. Builds
//! before the Kore rename wrote `<asset>.reflect.md` with a `reflectAsset:
//! true` marker; the name is now `<asset>.kore.md` with `koreAsset: true`
//! (`DESCRIPTION_SUFFIX` in `packages/core/src/graph/paths.ts`). Opening a
//! vault renames every old file whose new name is free and rewrites the
//! marker when the bytes are on this device. An evicted iCloud file is only
//! renamed (a metadata change), so reading it never forces a download; core
//! still accepts the old marker for that case.

use std::fs;
use std::path::Path;

use reflect_graph_paths::is_dataless;

use super::io::atomic_write;

const LEGACY_SUFFIX: &str = ".reflect.md";
const SUFFIX: &str = ".kore.md";
const LEGACY_MARKER: &str = "reflectAsset: true";
const MARKER: &str = "koreAsset: true";

/// Rename `assets/**/*.reflect.md` to `*.kore.md`. Best effort: a file that
/// cannot be moved stays where it is and is retried on the next open.
pub(super) fn migrate(root: &Path) {
    let assets = root.join("assets");
    if fs::symlink_metadata(&assets).is_ok_and(|metadata| metadata.file_type().is_dir()) {
        walk(root, &assets);
    }
}

fn walk(root: &Path, dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        let path = entry.path();
        if kind.is_dir() {
            walk(root, &path);
            continue;
        }
        if !kind.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        let Some(stem) = name.strip_suffix(LEGACY_SUFFIX) else {
            continue;
        };
        let target = path.with_file_name(format!("{stem}{SUFFIX}"));
        if fs::symlink_metadata(&target).is_ok() {
            continue;
        }
        let local = entry
            .metadata()
            .is_ok_and(|metadata| !is_dataless(&metadata));
        let rewritten = local
            .then(|| fs::read_to_string(&path).ok())
            .flatten()
            .filter(|source| source.contains(LEGACY_MARKER))
            .map(|source| source.replacen(LEGACY_MARKER, MARKER, 1));
        match rewritten {
            Some(source) => {
                if atomic_write(root, &target, &source).is_ok() {
                    let _ = fs::remove_file(&path);
                }
            }
            None => {
                let _ = fs::rename(&path, &target);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renames_old_descriptions_and_their_marker() {
        let graph = tempfile::tempdir().unwrap();
        let root = graph.path();
        fs::create_dir_all(root.join(".kore/tmp")).unwrap();
        fs::create_dir_all(root.join("assets/sub")).unwrap();
        fs::write(
            root.join("assets/sub/a.png.reflect.md"),
            "---\nreflectAsset: true\nsource: assets/sub/a.png\n---\nA chart.\n",
        )
        .unwrap();
        fs::write(root.join("assets/b.png.reflect.md"), "old").unwrap();
        fs::write(root.join("assets/b.png.kore.md"), "new").unwrap();

        migrate(root);

        assert_eq!(
            fs::read_to_string(root.join("assets/sub/a.png.kore.md")).unwrap(),
            "---\nkoreAsset: true\nsource: assets/sub/a.png\n---\nA chart.\n"
        );
        assert!(!root.join("assets/sub/a.png.reflect.md").exists());
        // A clash keeps both; nothing is overwritten.
        assert_eq!(
            fs::read_to_string(root.join("assets/b.png.kore.md")).unwrap(),
            "new"
        );
        assert!(root.join("assets/b.png.reflect.md").exists());
    }
}
