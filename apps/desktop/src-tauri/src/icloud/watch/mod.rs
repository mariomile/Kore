//! The iCloud change watcher: an `NSMetadataQuery` over the graph (Plan 21
//! Phase 2).
//!
//! Two jobs, per platform:
//!
//! - **iOS**: the *sole* external-change source. There is no file watcher on
//!   mobile — this query's snapshot diffs become the standard `index:changed`
//!   batches the indexer and open sessions already consume.
//! - **Both Apple platforms**: the conflict signal. A conflict version
//!   appearing does not necessarily touch the working file, so the desktop
//!   `notify` watcher alone would sit silent; the query's
//!   `HasUnresolvedConflicts` flag is what triggers a sweep promptly.
//!
//! Threading follows the platform contract: the query starts/stops on the
//! main thread (kept there via `MainThreadBound`), results are delivered on a
//! private `NSOperationQueue`, and the notification handler diffs a plain
//! Rust snapshot — no Objective-C state crosses threads.
//!
//! Items whose download status is not "current" are tracked but never
//! reported as upserts (their bytes aren't local yet — the indexer would read
//! a stub) and never as removes (eviction is not deletion; the item is still
//! listed). When iCloud finishes a download, the next update round reports
//! the real upsert.
//!
//! Download nudges are **changed-only**: a placeholder is requested when its
//! content is something this device lacks (a new arrival, or a remote edit
//! reaching an evicted item), never because the OS evicted content we already
//! indexed — that would fight Optimize Storage indefinitely. Open-path
//! catch-up (placeholders the *index* lacks) is the reconcile's targeted
//! `icloud_request_downloads`, not this watch.

use crate::error::AppResult;

// [`state`] is the pure diff/nudge logic (kept free of Objective-C so it is
// unit testable); [`apple`] is the real `NSMetadataQuery` wiring; [`stub`] is
// the non-Apple no-op. `state` also compiles under `cfg(test)` regardless of
// target so its tests build on the Linux CI job, which has neither macOS nor
// iOS.
#[cfg(any(target_os = "macos", target_os = "ios"))]
mod apple;
#[cfg(any(target_os = "macos", target_os = "ios"))]
use apple as platform;

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
mod stub;
#[cfg(not(any(target_os = "macos", target_os = "ios")))]
use stub as platform;

#[cfg(any(target_os = "macos", target_os = "ios", test))]
mod state;

/// Command: watch the graph at `root` for iCloud changes. `emit_file_changes`
/// turns snapshot diffs into `index:changed` events — pass `true` on mobile
/// (no watcher there), `false` on desktop (the `notify` watcher already
/// reports file events; double delivery is harmless but wasteful). Conflict
/// paths always emit as `icloud:conflicts`.
#[tauri::command]
pub async fn icloud_watch_start(
    root: String,
    emit_file_changes: bool,
    app: tauri::AppHandle,
) -> AppResult<()> {
    // Whether the query's scope actually covers this root — it lists the
    // app's own ubiquity container only, so for any other iCloud path (a
    // desktop graph in the user's general iCloud Drive) the gather produces
    // an empty view that must read as "unknown", never "no conflicts".
    // Resolved off the main thread: the container API can block on first
    // use. Best-effort — a failed probe degrades to "not authoritative"
    // (sweeps go full, the safe direction) rather than failing the start:
    // on mobile this watch is the sole external-change source, and losing
    // it over a coverage probe would be the far worse trade.
    let authoritative = {
        let root = root.clone();
        crate::blocking::run_blocking(move || Ok(query_covers_root(&root)))
            .await
            .unwrap_or(false)
    };
    platform::start(app, root, emit_file_changes, authoritative)
}

/// See [`icloud_watch_start`]: `root` lives inside the app's own ubiquity
/// container. The lookup is a pure path resolve — watching a graph kept
/// elsewhere in iCloud Drive must not create the container as a side effect.
fn query_covers_root(root: &str) -> bool {
    match super::storage::ubiquity_documents_path() {
        Some(documents) => root_within(std::path::Path::new(root), &documents),
        None => false,
    }
}

/// Canonicalized prefix check — iOS containers sit behind the `/var` →
/// `/private/var` symlink, and a lexical compare would miss. A path that
/// fails to canonicalize (not on disk) compares as spelled.
fn root_within(root: &std::path::Path, documents: &std::path::Path) -> bool {
    fn canonical(path: &std::path::Path) -> std::path::PathBuf {
        std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
    }
    canonical(root).starts_with(canonical(documents))
}

#[cfg(test)]
mod coverage_tests {
    use super::root_within;

    #[test]
    fn resolves_symlinked_spellings_before_comparing() {
        let dir = tempfile::tempdir().unwrap();
        let documents = dir.path().join("container/Documents");
        std::fs::create_dir_all(documents.join("Graph")).unwrap();
        std::os::unix::fs::symlink(dir.path().join("container"), dir.path().join("alias")).unwrap();

        assert!(root_within(&documents.join("Graph"), &documents));
        // The same graph reached through a symlinked spelling still matches —
        // the iOS `/var` → `/private/var` shape.
        assert!(root_within(
            &dir.path().join("alias/Documents/Graph"),
            &documents
        ));
        // A sibling outside the container never does.
        let elsewhere = dir.path().join("CloudDocs/Graph");
        std::fs::create_dir_all(&elsewhere).unwrap();
        assert!(!root_within(&elsewhere, &documents));
    }
}

/// Command: stop the active watch (graph switch or shutdown). Idempotent.
#[tauri::command]
pub fn icloud_watch_stop(app: tauri::AppHandle) -> AppResult<()> {
    platform::stop(app)
}

/// The paths the live metadata query currently flags as carrying unresolved
/// conflict versions — the scoped conflict sweep's candidate set. `None`
/// whenever the query cannot answer completely (no watch installed, or the
/// gather round hasn't seeded the view yet); callers must treat `None` as
/// "check everything". The set may run momentarily stale in the harmless
/// direction only: a just-resolved path lingers until its update round lands
/// (an extra no-op check), while a new conflict is always in the set before
/// the `icloud:conflicts` signal that triggers a sweep, because both come
/// from the same notification round.
pub(crate) fn conflicted_paths() -> Option<std::collections::HashSet<String>> {
    platform::conflicted_paths()
}
