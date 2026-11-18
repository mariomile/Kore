//! Give synced notes their real edit time.
//!
//! A checkout stamps every file it writes with *now*, so after a pull (or a
//! fresh clone) a note that another device or an agent edited hours ago looks
//! like it was edited the moment it arrived, and "Last updated" sorts put the
//! whole pull on top. The history already knows when each change was made:
//! this module sets a written file's modification time back to the author
//! time of the newest commit that changed it — what `git restore-mtime` does —
//! so the index, the note lists and any other app reading the folder see the
//! edit time, not the sync time.
//!
//! A time only ever moves backwards: when the file's own mtime is already
//! older than its commit (edited here, committed later), the file's time is
//! the more accurate one and stays.

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use git2::{Oid, Repository, Sort};

use crate::error::AppResult;

/// Ceiling on commits walked, so a very long history can't stall a sync.
/// Paths the walk doesn't reach take the oldest walked commit's time: they
/// last changed before it.
const MAX_WALKED_COMMITS: usize = 5_000;

/// Marker in the Git directory recording that the one-time backfill ran, so
/// checkouts made before this module existed are repaired exactly once.
const BACKFILL_MARKER: &str = "kore-edit-times-v1";

/// Whether `path` is a Markdown note — the files note lists sort by time.
pub(super) fn is_note(path: &str) -> bool {
    Path::new(path)
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
}

/// The author time of the newest commit reachable from `tips` (and not from
/// `hide`) that changed each of `paths`, in epoch ms, capped at now. Merge
/// commits are skipped: they record when histories were joined, not when
/// anything was written. Paths the walk never reaches are absent.
fn last_change_times(
    repo: &Repository,
    tips: &[Oid],
    hide: &[Oid],
    paths: impl IntoIterator<Item = String>,
) -> AppResult<HashMap<String, u64>> {
    let mut pending: std::collections::HashSet<String> = paths.into_iter().collect();
    let mut times = HashMap::new();
    if pending.is_empty() {
        return Ok(times);
    }
    let mut walk = repo.revwalk()?;
    walk.set_sorting(Sort::TIME)?;
    for tip in tips {
        walk.push(*tip)?;
    }
    for oid in hide {
        walk.hide(*oid)?;
    }
    let now = now_ms();
    let mut oldest = None;
    for oid in walk.take(MAX_WALKED_COMMITS) {
        let commit = repo.find_commit(oid?)?;
        let time = commit_time_ms(&commit).min(now);
        oldest = Some(time);
        if commit.parent_count() > 1 {
            continue;
        }
        // A root commit (or a shallow clone's oldest one, whose parents
        // weren't fetched) diffs against nothing: everything it holds was
        // last changed no later than it.
        let parent_tree = commit.parent(0).ok().and_then(|parent| parent.tree().ok());
        let diff = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&commit.tree()?), None)?;
        for delta in diff.deltas() {
            let Some(path) = delta.new_file().path() else {
                continue;
            };
            let path = path.to_string_lossy().replace('\\', "/");
            if pending.remove(&path) {
                times.insert(path, time);
            }
        }
        if pending.is_empty() {
            return Ok(times);
        }
    }
    // Walk capped (or history ended inside a shallow clone): the rest last
    // changed before the oldest commit seen.
    if hide.is_empty() {
        if let Some(oldest) = oldest {
            times.extend(pending.into_iter().map(|path| (path, oldest)));
        }
    }
    Ok(times)
}

/// Set `rel`'s mtime to `edit_ms` when that is older than its current one.
/// Returns the file's resulting mtime (epoch ms), or `None` when it can't be
/// read.
pub(super) fn apply_edit_time(root: &Path, rel: &str, edit_ms: Option<u64>) -> Option<u64> {
    let path = root.join(rel);
    let current = crate::fs::modified_ms(&path.metadata().ok()?)?;
    match edit_ms {
        Some(edit) if edit < current => {
            let time = UNIX_EPOCH + Duration::from_millis(edit);
            // Opened read-only: setting times needs ownership, not write access.
            match fs::File::open(&path).and_then(|file| file.set_modified(time)) {
                Ok(()) => Some(edit),
                Err(_) => Some(current),
            }
        }
        _ => Some(current),
    }
}

/// Edit times for files a pull just wrote: the newest commit on the incoming
/// side(s) that changed each path. `tips` are the merged heads; `base` the
/// commit they diverged from (`None` for a fresh/unborn checkout).
pub(super) fn incoming_edit_times(
    repo: &Repository,
    tips: &[Oid],
    base: Option<Oid>,
    paths: impl IntoIterator<Item = String>,
) -> HashMap<String, u64> {
    let hide: Vec<Oid> = base.into_iter().collect();
    // Best effort: a failed walk keeps the checkout's own times.
    last_change_times(repo, tips, &hide, paths).unwrap_or_default()
}

/// One-time repair for checkouts made before pulls kept edit times: every
/// Markdown note in `HEAD` whose mtime is newer than its last commit gets the
/// commit's time. Only notes: they are what lists sort, and touching every
/// attachment's stat would make the next commit re-hash all of them. Runs
/// once per repository (a marker in the Git directory); the next index
/// reconcile picks the corrected times up.
pub(super) fn ensure_backfilled(repo: &Repository, root: &Path) -> AppResult<()> {
    let marker = repo.path().join(BACKFILL_MARKER);
    if marker.exists() {
        return Ok(());
    }
    let Ok(head) = repo.head().and_then(|head| head.peel_to_commit()) else {
        // Nothing committed yet: nothing to repair, and nothing to mark.
        return Ok(());
    };
    let mut notes = Vec::new();
    head.tree()?
        .walk(git2::TreeWalkMode::PreOrder, |dir, entry| {
            if entry.kind() == Some(git2::ObjectType::Blob) {
                if let Ok(name) = entry.name() {
                    let path = format!("{dir}{name}");
                    if is_note(&path) {
                        notes.push(path);
                    }
                }
            }
            git2::TreeWalkResult::Ok
        })?;
    let times = last_change_times(repo, &[head.id()], &[], notes)?;
    for (rel, time) in &times {
        apply_edit_time(root, rel, Some(*time));
    }
    fs::write(&marker, b"")?;
    Ok(())
}

fn commit_time_ms(commit: &git2::Commit<'_>) -> u64 {
    u64::try_from(commit.author().when().seconds())
        .unwrap_or(0)
        .saturating_mul(1000)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| u64::try_from(duration.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(u64::MAX)
}
