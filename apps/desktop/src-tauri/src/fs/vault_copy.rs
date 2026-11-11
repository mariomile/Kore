//! Copying a vault into a new folder, for the Obsidian import (Plan 31,
//! slice 2).
//!
//! These are the only commands besides `export_write` that write outside the
//! open graph, and they never write *to* it: the open graph is the source,
//! read-only, and the destination is a folder the user just picked that must
//! be empty and must neither hold nor sit inside the graph. Which file goes
//! where and what each note says afterwards is decided in core; Rust only
//! copies bytes, applies the renames it is handed and overwrites files the
//! copy itself produced.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::{AppError, AppResult};

use super::{current_root, root_for_generation, GraphState};

/// One file that changes path in the copy. Both sides are graph-relative,
/// `/`-separated.
#[derive(Debug, Clone, Deserialize)]
pub struct VaultCopyRename {
    pub from: String,
    pub to: String,
}

/// One file of the copy whose contents core rewrote.
#[derive(Debug, Clone, Deserialize)]
pub struct VaultCopyFile {
    pub path: String,
    pub contents: String,
}

/// The folders `vault_copy_tree` copied a vault into during this run of the
/// app, canonicalized. `vault_copy_write` writes only inside one of them, so
/// it is never a general file writer: the folder had to be empty and outside
/// the graph when the copy was made.
#[derive(Default)]
pub struct VaultCopies(Mutex<HashSet<PathBuf>>);

impl VaultCopies {
    fn insert(&self, dest: PathBuf) -> AppResult<()> {
        self.0
            .lock()
            .map_err(|_| AppError::io("vault copy registry poisoned"))?
            .insert(dest);
        Ok(())
    }

    /// `destination`, canonicalized, when it is a folder this run copied into.
    fn made(&self, destination: &str) -> AppResult<PathBuf> {
        let dest = existing_dir(destination)?;
        let known = self
            .0
            .lock()
            .map_err(|_| AppError::io("vault copy registry poisoned"))?
            .contains(&dest);
        if known {
            Ok(dest)
        } else {
            Err(AppError::io(format!(
                "not a folder Kore copied a vault into: {destination}"
            )))
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct VaultCopyStats {
    /// Files copied.
    pub files: u64,
    /// Bytes copied.
    pub bytes: u64,
    /// Entries left behind because they are symlinks: following one could
    /// copy a tree from outside the vault.
    pub symlinks: u64,
}

/// Copy the graph opened at `generation` into the empty folder `destination`,
/// leaving out every entry under a `skip` prefix and moving each `renames`
/// source to its target. Never overwrites: a second file landing on a path
/// already copied fails the whole command.
#[tauri::command]
pub async fn vault_copy_tree(
    generation: u64,
    destination: String,
    renames: Vec<VaultCopyRename>,
    skip: Vec<String>,
    state: State<'_, GraphState>,
    copies: State<'_, VaultCopies>,
) -> AppResult<VaultCopyStats> {
    let root = root_for_generation(&state, generation)?;
    let (dest, stats) =
        crate::blocking::run_blocking(move || copy_tree(&root, &destination, &renames, &skip))
            .await?;
    copies.insert(dest)?;
    Ok(stats)
}

/// Overwrite files of a copy made by [`vault_copy_tree`] with the contents
/// core decided. Only a folder [`vault_copy_tree`] copied into during this
/// run can be written, and only files the copy already holds, so this cannot
/// create files; a destination that is or overlaps the open graph is refused.
#[tauri::command]
pub async fn vault_copy_write(
    destination: String,
    files: Vec<VaultCopyFile>,
    state: State<'_, GraphState>,
    copies: State<'_, VaultCopies>,
) -> AppResult<()> {
    copies.made(&destination)?;
    let graph = current_root(&state).ok();
    crate::blocking::run_blocking(move || write_files(graph.as_deref(), &destination, &files)).await
}

/// A graph-relative path as a native relative path, refusing anything that
/// could leave the folder it is joined to.
fn relative(path: &str) -> AppResult<PathBuf> {
    let native = Path::new(path);
    let mut out = PathBuf::new();
    for component in native.components() {
        match component {
            Component::Normal(part) => out.push(part),
            _ => {
                return Err(AppError::traversal(format!("not a relative path: {path}")));
            }
        }
    }
    if out.as_os_str().is_empty() || path.contains('\\') {
        return Err(AppError::traversal(format!("not a relative path: {path}")));
    }
    Ok(out)
}

/// An absolute, existing directory, canonicalized.
fn existing_dir(path: &str) -> AppResult<PathBuf> {
    let native = PathBuf::from(path);
    if !native.is_absolute() {
        return Err(AppError::traversal(format!(
            "destination must be absolute: {path}"
        )));
    }
    let canonical = native
        .canonicalize()
        .map_err(|err| AppError::io(format!("cannot open {path}: {err}")))?;
    if !canonical.is_dir() {
        return Err(AppError::io(format!("not a folder: {path}")));
    }
    Ok(canonical)
}

fn overlaps(a: &Path, b: &Path) -> bool {
    a.starts_with(b) || b.starts_with(a)
}

/// Finder drops `.DS_Store` into a folder as soon as it shows it; that alone
/// doesn't make a folder someone's data.
fn is_empty_dir(dir: &Path) -> AppResult<bool> {
    let entries = fs::read_dir(dir)
        .map_err(|err| AppError::io(format!("cannot list {}: {err}", dir.display())))?;
    for entry in entries {
        let entry = entry.map_err(|err| AppError::io(err.to_string()))?;
        if entry.file_name() != ".DS_Store" {
            return Ok(false);
        }
    }
    Ok(true)
}

fn is_skipped(rel: &str, skip: &[String]) -> bool {
    skip.iter().any(|prefix| {
        rel == prefix
            || rel
                .strip_prefix(prefix.as_str())
                .is_some_and(|rest| rest.starts_with('/'))
    })
}

fn copy_tree(
    root: &Path,
    destination: &str,
    renames: &[VaultCopyRename],
    skip: &[String],
) -> AppResult<(PathBuf, VaultCopyStats)> {
    let root = root
        .canonicalize()
        .map_err(|err| AppError::io(format!("cannot open the vault: {err}")))?;
    let dest = existing_dir(destination)?;
    if overlaps(&root, &dest) {
        return Err(AppError::io(
            "the copy must go in a folder outside the vault, and the vault can't be inside it",
        ));
    }
    if !is_empty_dir(&dest)? {
        return Err(AppError::io(format!(
            "the folder isn't empty: {}",
            dest.display()
        )));
    }
    let mut targets: HashMap<&str, PathBuf> = HashMap::with_capacity(renames.len());
    for rename in renames {
        relative(&rename.from)?;
        targets.insert(rename.from.as_str(), relative(&rename.to)?);
    }

    let mut stats = VaultCopyStats::default();
    let mut pending = vec![PathBuf::new()];
    while let Some(dir) = pending.pop() {
        let entries = fs::read_dir(root.join(&dir))
            .map_err(|err| AppError::io(format!("cannot list {}: {err}", dir.display())))?;
        for entry in entries {
            let entry = entry.map_err(|err| AppError::io(err.to_string()))?;
            let rel = dir.join(entry.file_name());
            let wire = rel.to_string_lossy().replace('\\', "/");
            if is_skipped(&wire, skip) {
                continue;
            }
            let kind = entry
                .file_type()
                .map_err(|err| AppError::io(format!("cannot read {wire}: {err}")))?;
            if kind.is_symlink() {
                stats.symlinks += 1;
            } else if kind.is_dir() {
                pending.push(rel);
            } else if kind.is_file() {
                let target = dest.join(targets.get(wire.as_str()).unwrap_or(&rel));
                if let Some(parent) = target.parent() {
                    fs::create_dir_all(parent).map_err(|err| {
                        AppError::io(format!("cannot create {}: {err}", parent.display()))
                    })?;
                }
                if target.symlink_metadata().is_ok() {
                    return Err(AppError::io(format!(
                        "two files would land on {}",
                        target.display()
                    )));
                }
                stats.bytes += fs::copy(entry.path(), &target)
                    .map_err(|err| AppError::io(format!("cannot copy {wire}: {err}")))?;
                stats.files += 1;
            }
        }
    }
    Ok((dest, stats))
}

fn write_files(graph: Option<&Path>, destination: &str, files: &[VaultCopyFile]) -> AppResult<()> {
    let dest = existing_dir(destination)?;
    if let Some(graph) = graph.and_then(|graph| graph.canonicalize().ok()) {
        if overlaps(&graph, &dest) {
            return Err(AppError::io("refusing to write into the open vault"));
        }
    }
    for file in files {
        let target = dest.join(relative(&file.path)?);
        let meta = target
            .symlink_metadata()
            .map_err(|_| AppError::not_found(format!("not in the copy: {}", file.path)))?;
        if !meta.is_file() {
            return Err(AppError::io(format!("not a file: {}", file.path)));
        }
        fs::write(&target, &file.contents)
            .map_err(|err| AppError::io(format!("cannot write {}: {err}", file.path)))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(root: &Path, rel: &str, contents: &str) {
        let path = root.join(rel);
        fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
        fs::write(path, contents).expect("write");
    }

    fn read(root: &Path, rel: &str) -> String {
        fs::read_to_string(root.join(rel)).expect("read")
    }

    fn rename(from: &str, to: &str) -> VaultCopyRename {
        VaultCopyRename {
            from: from.to_string(),
            to: to.to_string(),
        }
    }

    fn dest_str(dir: &Path) -> String {
        dir.to_string_lossy().into_owned()
    }

    #[test]
    fn copies_renames_and_skips_without_touching_the_source() {
        let vault = tempfile::tempdir().expect("vault");
        let out = tempfile::tempdir().expect("out");
        write(vault.path(), "Journal/Daily/09-10-2026.md", "day");
        write(vault.path(), "Notes/Idea.md", "idea");
        write(vault.path(), ".obsidian/app.json", "{}");
        write(vault.path(), ".git/HEAD", "ref");
        write(vault.path(), "Archive/Old.md", "old");
        write(
            vault.path(),
            "Archived.md",
            "kept: only the folder is left out",
        );

        let (_, stats) = copy_tree(
            vault.path(),
            &dest_str(out.path()),
            &[rename("Journal/Daily/09-10-2026.md", "daily/2026-10-09.md")],
            &[".git".to_string(), "Archive".to_string()],
        )
        .expect("copy");

        assert_eq!(stats.files, 4);
        assert_eq!(read(out.path(), "daily/2026-10-09.md"), "day");
        assert_eq!(read(out.path(), "Notes/Idea.md"), "idea");
        assert_eq!(read(out.path(), ".obsidian/app.json"), "{}");
        assert_eq!(
            read(out.path(), "Archived.md"),
            "kept: only the folder is left out"
        );
        assert!(!out.path().join("Journal/Daily/09-10-2026.md").exists());
        assert!(!out.path().join(".git").exists());
        assert!(!out.path().join("Archive").exists());
        assert_eq!(read(vault.path(), "Journal/Daily/09-10-2026.md"), "day");
    }

    #[test]
    fn refuses_a_destination_that_is_not_empty_or_overlaps_the_vault() {
        let vault = tempfile::tempdir().expect("vault");
        write(vault.path(), "Note.md", "x");
        let busy = tempfile::tempdir().expect("busy");
        write(busy.path(), "mine.txt", "y");
        assert!(copy_tree(vault.path(), &dest_str(busy.path()), &[], &[]).is_err());

        let inside = vault.path().join("copy");
        fs::create_dir(&inside).expect("mkdir");
        assert!(copy_tree(vault.path(), &dest_str(&inside), &[], &[]).is_err());
        assert!(copy_tree(vault.path(), "relative/path", &[], &[]).is_err());

        let finder = tempfile::tempdir().expect("finder");
        write(finder.path(), ".DS_Store", "");
        assert!(copy_tree(vault.path(), &dest_str(finder.path()), &[], &[]).is_ok());
    }

    #[test]
    fn refuses_renames_that_escape_or_collide() {
        let vault = tempfile::tempdir().expect("vault");
        write(vault.path(), "a.md", "a");
        write(vault.path(), "b.md", "b");
        let out = tempfile::tempdir().expect("out");
        assert!(copy_tree(
            vault.path(),
            &dest_str(out.path()),
            &[rename("a.md", "../escape.md")],
            &[],
        )
        .is_err());

        let out = tempfile::tempdir().expect("out");
        assert!(copy_tree(
            vault.path(),
            &dest_str(out.path()),
            &[rename("a.md", "c.md"), rename("b.md", "c.md")],
            &[],
        )
        .is_err());
    }

    #[test]
    fn only_folders_a_copy_went_into_are_writable() {
        let vault = tempfile::tempdir().expect("vault");
        write(vault.path(), "Note.md", "x");
        let out = tempfile::tempdir().expect("out");
        let elsewhere = tempfile::tempdir().expect("elsewhere");
        let copies = VaultCopies::default();
        let (dest, _) = copy_tree(vault.path(), &dest_str(out.path()), &[], &[]).expect("copy");
        copies.insert(dest).expect("insert");

        assert!(copies.made(&dest_str(out.path())).is_ok());
        assert!(copies.made(&dest_str(elsewhere.path())).is_err());
        assert!(copies.made(&dest_str(vault.path())).is_err());
    }

    #[test]
    fn writes_only_files_the_copy_holds_and_never_into_the_vault() {
        let vault = tempfile::tempdir().expect("vault");
        let out = tempfile::tempdir().expect("out");
        write(out.path(), "Note.md", "old");
        let file = |path: &str| VaultCopyFile {
            path: path.to_string(),
            contents: "new".to_string(),
        };

        write_files(
            Some(vault.path()),
            &dest_str(out.path()),
            &[file("Note.md")],
        )
        .expect("write");
        assert_eq!(read(out.path(), "Note.md"), "new");

        assert!(write_files(None, &dest_str(out.path()), &[file("Missing.md")]).is_err());
        assert!(write_files(None, &dest_str(out.path()), &[file("../Note.md")]).is_err());

        write(vault.path(), "Note.md", "vault");
        assert!(write_files(
            Some(vault.path()),
            &dest_str(vault.path()),
            &[file("Note.md")]
        )
        .is_err());
        assert_eq!(read(vault.path(), "Note.md"), "vault");
    }
}
