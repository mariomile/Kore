//! Per-note version history over the graph's local backup repository.
//!
//! Every desktop graph carries continuous Git history (the commit-only sync
//! loop runs even with no remote), so a note's past versions already exist —
//! this module only reads them. The walk follows first parents from `HEAD`
//! and records the commits where the note's blob changed (created or
//! modified; a deletion shows up as the following version's re-creation).
//! Restore is not a Git operation: the frontend writes the old content back
//! through the ordinary note write path, which the next sync commit records
//! — so a restore is itself just another version, and nothing rewrites
//! history.

use std::path::Path;

use serde::Serialize;

use crate::error::{AppError, AppResult};

/// One entry in a note's timeline, newest first.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteVersion {
    /// Full commit id — the handle `git_note_version` takes.
    pub commit: String,
    /// Commit time, epoch milliseconds.
    pub time_ms: i64,
    /// First line of the commit message.
    pub summary: String,
}

/// Ceiling on commits walked, so a decade-old graph can't stall the panel.
const MAX_WALKED_COMMITS: usize = 20_000;

/// The blob id `rel_path` has in `commit`'s tree, or `None` when absent.
fn blob_id(commit: &git2::Commit<'_>, rel_path: &str) -> Option<git2::Oid> {
    let tree = commit.tree().ok()?;
    let entry = tree.get_path(Path::new(rel_path)).ok()?;
    (entry.kind() == Some(git2::ObjectType::Blob)).then(|| entry.id())
}

/// The commits (newest first, following first parents) where `rel_path`'s
/// content changed — its version timeline.
pub(super) fn note_history(
    root: &Path,
    rel_path: &str,
    limit: usize,
) -> AppResult<Vec<NoteVersion>> {
    let repo = super::repo::open_existing(root)?;
    let mut versions = Vec::new();
    let Ok(head) = repo.head() else {
        return Ok(versions); // Unborn branch: no commits yet.
    };
    let mut current = Some(head.peel_to_commit()?);
    let mut walked = 0;
    while let Some(commit) = current {
        walked += 1;
        if versions.len() >= limit || walked > MAX_WALKED_COMMITS {
            break;
        }
        let parent = commit.parent(0).ok();
        let own = blob_id(&commit, rel_path);
        let before = parent
            .as_ref()
            .and_then(|parent| blob_id(parent, rel_path));
        if let Some(own) = own {
            if Some(own) != before {
                versions.push(NoteVersion {
                    commit: commit.id().to_string(),
                    time_ms: commit.time().seconds() * 1000,
                    summary: commit.summary().ok().flatten().unwrap_or("").to_string(),
                });
            }
        }
        current = parent;
    }
    Ok(versions)
}

/// `rel_path`'s content in `commit_id`'s tree.
pub(super) fn note_version_content(
    root: &Path,
    commit_id: &str,
    rel_path: &str,
) -> AppResult<String> {
    let repo = super::repo::open_existing(root)?;
    let oid = git2::Oid::from_str(commit_id)
        .map_err(|_| AppError::not_found(format!("unknown version {commit_id}")))?;
    let commit = repo
        .find_commit(oid)
        .map_err(|_| AppError::not_found(format!("unknown version {commit_id}")))?;
    let tree = commit.tree()?;
    let entry = tree
        .get_path(Path::new(rel_path))
        .map_err(|_| AppError::not_found(format!("{rel_path} is not in version {commit_id}")))?;
    let blob = repo
        .find_blob(entry.id())
        .map_err(|_| AppError::not_found(format!("{rel_path} is not a file in {commit_id}")))?;
    Ok(String::from_utf8_lossy(blob.content()).into_owned())
}


/// Snapshot the graph before an agent run: commit whatever is pending and
/// return `HEAD`'s id — the baseline `changed_since` diffs against. `None`
/// on an unborn repository (nothing to diff yet, and nothing at risk).
pub(super) fn agent_snapshot(root: &Path, max_file_bytes: u64) -> AppResult<Option<String>> {
    super::commit::commit_all(root, "Before agent run", max_file_bytes)?;
    let repo = super::repo::open_existing(root)?;
    let head = match repo.head() {
        Ok(head) => head,
        Err(_) => return Ok(None),
    };
    let id = head.peel_to_commit()?.id().to_string();
    Ok(Some(id))
}

/// Graph-relative paths whose content differs between `commit_id`'s tree and
/// the working directory (index included) — what an agent run touched when
/// diffed against its [`agent_snapshot`]. Deletions count: a vanished note
/// is a change the user must be able to see and restore.
pub(super) fn changed_since(root: &Path, commit_id: &str) -> AppResult<Vec<String>> {
    let repo = super::repo::open_existing(root)?;
    let oid = git2::Oid::from_str(commit_id)
        .map_err(|_| AppError::not_found(format!("unknown snapshot {commit_id}")))?;
    let commit = repo
        .find_commit(oid)
        .map_err(|_| AppError::not_found(format!("unknown snapshot {commit_id}")))?;
    let tree = commit.tree()?;
    let mut options = git2::DiffOptions::new();
    options.include_untracked(true).recurse_untracked_dirs(true);
    let diff = repo.diff_tree_to_workdir_with_index(Some(&tree), Some(&mut options))?;
    let mut paths: Vec<String> = Vec::new();
    for delta in diff.deltas() {
        let path = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .map(|path| path.to_string_lossy().into_owned());
        if let Some(path) = path {
            if !paths.contains(&path) {
                paths.push(path);
            }
        }
    }
    paths.sort();
    Ok(paths)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use super::{note_history, note_version_content};
    use crate::git::commit::commit_all;
    use crate::git::repo::open_or_init;

    fn commit(root: &Path, message: &str) {
        commit_all(root, message, u64::MAX).unwrap();
    }

    fn scaffold(root: &Path) {
        fs::create_dir_all(root.join("notes")).unwrap();
        open_or_init(root).unwrap();
    }

    #[test]
    fn timeline_lists_only_commits_that_changed_the_note() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        scaffold(root);

        fs::write(root.join("notes/a.md"), "# A\nv1\n").unwrap();
        commit(root, "create a");
        fs::write(root.join("notes/b.md"), "# B\n").unwrap();
        commit(root, "create b (a untouched)");
        fs::write(root.join("notes/a.md"), "# A\nv2\n").unwrap();
        commit(root, "edit a");

        let versions = note_history(root, "notes/a.md", 50).unwrap();
        // Two versions: creation and the edit — the b-only commit is skipped.
        // Summaries are the sync loop's generated messages, not our inputs.
        assert_eq!(versions.len(), 2);
        assert!(!versions[0].summary.is_empty());
        assert!(versions[0].time_ms >= versions[1].time_ms);

        assert_eq!(
            note_version_content(root, &versions[1].commit, "notes/a.md").unwrap(),
            "# A\nv1\n"
        );
        assert_eq!(
            note_version_content(root, &versions[0].commit, "notes/a.md").unwrap(),
            "# A\nv2\n"
        );
    }

    #[test]
    fn limit_and_missing_paths_behave() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        scaffold(root);
        for revision in 0..4 {
            fs::write(root.join("notes/a.md"), format!("v{revision}\n")).unwrap();
            commit(root, &format!("edit {revision}"));
        }

        let versions = note_history(root, "notes/a.md", 2).unwrap();
        assert_eq!(versions.len(), 2);
        assert_eq!(
            note_version_content(root, &versions[0].commit, "notes/a.md").unwrap(),
            "v3\n"
        );

        assert!(note_history(root, "notes/never.md", 10).unwrap().is_empty());
        let head = &versions[0].commit;
        assert!(note_version_content(root, head, "notes/never.md").is_err());
        assert!(note_version_content(root, "not-a-sha", "notes/a.md").is_err());
    }

    #[test]
    fn snapshot_and_changed_since_track_an_agent_run() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        scaffold(root);
        fs::write(root.join("notes/a.md"), "v1\n").unwrap();

        let snapshot = super::agent_snapshot(root, u64::MAX).unwrap().unwrap();
        assert!(super::changed_since(root, &snapshot).unwrap().is_empty());

        fs::write(root.join("notes/a.md"), "v2\n").unwrap();
        fs::write(root.join("notes/new.md"), "born\n").unwrap();
        fs::remove_file(root.join("notes/a.md")).ok();
        fs::write(root.join("notes/a.md"), "v2\n").unwrap();
        let changed = super::changed_since(root, &snapshot).unwrap();
        assert_eq!(changed, vec!["notes/a.md".to_string(), "notes/new.md".to_string()]);

        assert!(super::changed_since(root, "not-a-sha").is_err());
    }

    #[test]
    fn an_unborn_repository_has_an_empty_timeline() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        scaffold(root);
        assert!(note_history(root, "notes/a.md", 10).unwrap().is_empty());
    }
}
