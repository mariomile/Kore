//! How many files a sync would delete, measured before it writes anything.
//!
//! An agent once pushed a commit whose tree held only the two files it had
//! touched: merged as-is, that wipes every other note from disk and, pushed
//! back, from every device. The sync engine checks these counts before it
//! merges (`incoming`) and before it pushes (`outgoing`) and pauses for a yes
//! past its threshold; deciding the threshold is policy and lives in core.

use std::path::Path;

use git2::{Delta, DiffFindOptions, Oid, Repository, Tree, TreeWalkMode, TreeWalkResult};
use serde::Serialize;

use crate::error::AppResult;

use super::repo::{current_branch, open_existing};

/// Files each side removed since the local branch and the last-fetched
/// remote branch diverged, and how many files their common ancestor held.
#[derive(Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncDeletions {
    /// Removed on the remote: what merging it would delete on this device.
    pub incoming: usize,
    /// Removed locally: what pushing would delete on the remote.
    pub outgoing: usize,
    /// Files in the common ancestor, the vault size the counts compare to;
    /// 0 when neither side deleted anything.
    pub tracked: usize,
}

/// Count both sides' deletions against their merge base. Nothing to compare
/// (no remote branch yet, an unborn HEAD, unrelated histories) counts as zero:
/// those merges keep every local file and those pushes cannot remove any.
pub(super) fn sync_deletions(root: &Path) -> AppResult<SyncDeletions> {
    let repo = open_existing(root)?;
    let branch = current_branch(&repo)?;
    let Ok(remote) = repo.refname_to_id(&format!("refs/remotes/origin/{branch}")) else {
        return Ok(SyncDeletions::default());
    };
    let Ok(local) = repo.head().and_then(|head| head.peel_to_commit()) else {
        return Ok(SyncDeletions::default());
    };
    let Ok(base) = repo.merge_base(local.id(), remote) else {
        return Ok(SyncDeletions::default());
    };
    let base_tree = repo.find_commit(base)?.tree()?;
    let incoming = deleted_since(&repo, &base_tree, remote)?;
    let outgoing = deleted_since(&repo, &base_tree, local.id())?;
    // Most syncs delete nothing; skip walking the whole vault for them.
    let tracked = if incoming + outgoing > 0 {
        file_count(&base_tree)?
    } else {
        0
    };
    Ok(SyncDeletions {
        incoming,
        outgoing,
        tracked,
    })
}

/// Files in `base` missing from `commit`'s tree. A file moved unchanged is a
/// rename, not a deletion, so moving a folder never reads as a wipe.
fn deleted_since(repo: &Repository, base: &Tree, commit: Oid) -> AppResult<usize> {
    let tree = repo.find_commit(commit)?.tree()?;
    let mut diff = repo.diff_tree_to_tree(Some(base), Some(&tree), None)?;
    diff.find_similar(Some(
        DiffFindOptions::new().renames(true).exact_match_only(true),
    ))?;
    Ok(diff
        .deltas()
        .filter(|delta| delta.status() == Delta::Deleted)
        .count())
}

fn file_count(tree: &Tree) -> AppResult<usize> {
    let mut count = 0;
    tree.walk(TreeWalkMode::PreOrder, |_, entry| {
        if entry.kind() == Some(git2::ObjectType::Blob) {
            count += 1;
        }
        TreeWalkResult::Ok
    })?;
    Ok(count)
}
