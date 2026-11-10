//! Reverse a run of commits (Plan 33, A1 step 6): for every file the run
//! changed, three-way merge the version before the run into what is on disk
//! now, with the run's last version as the common ancestor. Later edits to
//! other lines survive; a file whose changed lines were edited again (or
//! that is not text) is a conflict.
//!
//! A preview only: nothing is written. `@reflect/core` decides whether to
//! go ahead (all or nothing) and writes the results through its ordinary
//! note paths, so the index and open editors follow.

use std::path::Path;

use git2::{DiffOptions, MergeFileInput, Repository, Tree};
use serde::Serialize;

use crate::error::{AppError, AppResult};

/// One file's state after the undo.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UndoFile {
    /// Graph-relative, forward-slashed.
    pub path: String,
    /// The content to write, or `None` to remove the file.
    pub content: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub enum UndoConflictReason {
    /// The lines the run changed were changed again afterwards.
    ChangedSince,
    /// Not UTF-8 text, so there is no line merge.
    Binary,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UndoConflict {
    pub path: String,
    pub reason: UndoConflictReason,
}

/// What undoing a run would do. Files already back to their pre-run state
/// are left out of `files`.
#[derive(Debug, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct UndoPreview {
    pub files: Vec<UndoFile>,
    pub conflicts: Vec<UndoConflict>,
}

/// Preview undoing the commits from `oldest` to `newest` (inclusive, along
/// first parents; `oldest`'s parent is the state restored).
pub(super) fn undo_preview(root: &Path, newest: &str, oldest: &str) -> AppResult<UndoPreview> {
    let repo = super::repo::open_existing(root)?;
    let newest = find_commit(&repo, newest)?;
    let oldest = find_commit(&repo, oldest)?;
    let after = newest.tree()?;
    let before = match oldest.parent(0) {
        Ok(parent) => Some(parent.tree()?),
        Err(_) => None,
    };

    let mut options = DiffOptions::new();
    let diff = repo.diff_tree_to_tree(before.as_ref(), Some(&after), Some(&mut options))?;
    let mut paths: Vec<String> = Vec::new();
    for delta in diff.deltas() {
        for file in [delta.old_file(), delta.new_file()] {
            if let Some(path) = file.path().and_then(Path::to_str) {
                let path = path.replace('\\', "/");
                if !paths.contains(&path) {
                    paths.push(path);
                }
            }
        }
    }
    paths.sort();

    let mut preview = UndoPreview::default();
    for path in paths {
        let base = blob_at(&repo, before.as_ref(), &path)?;
        let run = blob_at(&repo, Some(&after), &path)?;
        let disk = read_disk(root, &path)?;
        match revert_file(&path, base.as_deref(), run.as_deref(), disk.as_deref()) {
            Revert::Unchanged => {}
            Revert::Write(content) => preview.files.push(UndoFile { path, content }),
            Revert::Conflict(reason) => preview.conflicts.push(UndoConflict { path, reason }),
        }
    }
    Ok(preview)
}

enum Revert {
    Unchanged,
    Write(Option<String>),
    Conflict(UndoConflictReason),
}

/// Undo one file: `base` before the run, `run` after it, `disk` now.
fn revert_file(path: &str, base: Option<&[u8]>, run: Option<&[u8]>, disk: Option<&[u8]>) -> Revert {
    if disk == base {
        return Revert::Unchanged;
    }
    let target = |bytes: Option<&[u8]>| -> Revert {
        match bytes {
            None => Revert::Write(None),
            Some(bytes) => match std::str::from_utf8(bytes) {
                Ok(text) => Revert::Write(Some(text.to_string())),
                Err(_) => Revert::Conflict(UndoConflictReason::Binary),
            },
        }
    };
    if disk == run {
        // Nothing changed since the run: put the old version back as it was.
        return target(base);
    }
    let (Some(base), Some(run), Some(disk)) = (base, run, disk) else {
        // Created or removed by the run and changed again since.
        return Revert::Conflict(UndoConflictReason::ChangedSince);
    };
    if [base, run, disk]
        .iter()
        .any(|bytes| std::str::from_utf8(bytes).is_err())
    {
        return Revert::Conflict(UndoConflictReason::Binary);
    }
    // Reverse merge: the run's version is the ancestor, so the merge keeps
    // whatever changed since (ours) and takes back what the run changed.
    let mut ancestor = MergeFileInput::new();
    ancestor.content(run).path(path);
    let mut ours = MergeFileInput::new();
    ours.content(disk).path(path);
    let mut theirs = MergeFileInput::new();
    theirs.content(base).path(path);
    match git2::merge_file(&ancestor, &ours, &theirs, None) {
        Ok(merged) if merged.is_automergeable() => match std::str::from_utf8(merged.content()) {
            Ok(text) => Revert::Write(Some(text.to_string())),
            Err(_) => Revert::Conflict(UndoConflictReason::Binary),
        },
        _ => Revert::Conflict(UndoConflictReason::ChangedSince),
    }
}

fn find_commit<'r>(repo: &'r Repository, id: &str) -> AppResult<git2::Commit<'r>> {
    let oid =
        git2::Oid::from_str(id).map_err(|_| AppError::not_found(format!("unknown commit {id}")))?;
    repo.find_commit(oid)
        .map_err(|_| AppError::not_found(format!("unknown commit {id}")))
}

fn blob_at(repo: &Repository, tree: Option<&Tree<'_>>, path: &str) -> AppResult<Option<Vec<u8>>> {
    let Some(tree) = tree else {
        return Ok(None);
    };
    let Ok(entry) = tree.get_path(Path::new(path)) else {
        return Ok(None);
    };
    match repo.find_blob(entry.id()) {
        Ok(blob) => Ok(Some(blob.content().to_vec())),
        Err(_) => Ok(None),
    }
}

fn read_disk(root: &Path, path: &str) -> AppResult<Option<Vec<u8>>> {
    if path.split('/').any(|part| part == ".." || part.is_empty()) {
        return Err(AppError::traversal(format!("{path} leaves the vault")));
    }
    match std::fs::read(root.join(path)) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(AppError::io(format!("couldn't read {path}: {error}"))),
    }
}
