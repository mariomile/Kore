//! Pure diff/nudge logic for the iCloud watch — kept free of Objective-C
//! (see [`apply_update_delta`]) so it is unit testable, and gated to compile
//! under `cfg(test)` on every platform so those tests actually build on the
//! Linux CI job, which has neither macOS nor iOS. [`super::apple`] drives all
//! of this against the live `NSMetadataQuery`; nothing here touches
//! Objective-C or the watch's global state directly.

use std::collections::{HashMap, HashSet};

use serde::Serialize;

/// One tracked item's last-known sync state.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(super) enum TrackedState {
    /// Bytes are local, at this content-change mtime (epoch ms).
    Local(u64),
    /// Listed but not downloaded (a placeholder, or an eviction). The
    /// provider's content-change date rides along — it is cloud
    /// metadata, present without local bytes — so a *remote edit*
    /// reaching an evicted item is distinguishable from the eviction
    /// itself.
    Evicted(Option<u64>),
}

/// The scoped sweep's candidate view: the paths the provider currently
/// flags as carrying unresolved conflict versions, maintained by the
/// same rounds that emit `icloud:conflicts`. Everything that decides
/// whether the view may be *trusted* lives in the same struct, under one
/// lock, so a reader can never observe a torn combination (readiness
/// from one watch, paths from another):
///
/// - `epoch` pins the view to one install; rounds carry the epoch their
///   watch was installed with, and a stale round — an old query's
///   in-flight gather completing after teardown or after a newer graph's
///   install — folds into nothing.
/// - `authoritative` records whether the query's scope actually covers
///   the watched root (the app's own ubiquity container). For any other
///   iCloud path the query gathers an *empty* view that must read as
///   "unknown", never "no conflicts".
/// - `gathered` flips only when a full listing of this epoch lands;
///   before that the set is empty for the wrong reason.
#[derive(Default)]
pub(super) struct ConflictView {
    pub(super) epoch: u64,
    pub(super) authoritative: bool,
    pub(super) gathered: bool,
    pub(super) paths: HashSet<String>,
}

/// The watcher's change event, matching `watcher::FileChange`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct FileChange {
    path: String,
    kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    modified_ms: Option<u64>,
}

/// The root plus its canonicalized twin, both slash-terminated. Spotlight
/// reports real paths — on iOS the container lives behind the `/var` →
/// `/private/var` symlink, so a predicate (or a prefix strip) built from
/// the un-resolved root alone would match nothing and the watch would sit
/// silent. The trailing slash makes both the predicate and the strip a
/// real path boundary: `…/Notes` must never claim `…/Notes-old/…`.
pub(super) fn root_variants(root: &str) -> Vec<String> {
    let with_slash = |value: &str| format!("{}/", value.trim_end_matches('/'));
    let mut variants = vec![with_slash(root)];
    if let Ok(canonical) = std::fs::canonicalize(root) {
        let canonical = with_slash(&canonical.to_string_lossy());
        if !variants.contains(&canonical) {
            variants.push(canonical);
        }
    }
    variants
}

/// One tracked item's state, extracted from its `NSMetadataItem`.
pub(super) struct ItemState {
    /// Graph-relative note path.
    pub(super) rel: String,
    /// Absolute path, for download requests.
    pub(super) abs: String,
    /// True when the content is local ("current"); false for placeholders
    /// and partial downloads.
    pub(super) downloaded: bool,
    /// Content-change date (epoch ms), when the item reports one.
    pub(super) mtime: Option<u64>,
    /// The provider's unresolved-conflict flag.
    pub(super) conflict: bool,
}

impl ItemState {
    /// The snapshot value for this item.
    fn snapshot_state(&self) -> TrackedState {
        if self.downloaded {
            TrackedState::Local(self.mtime.unwrap_or(0))
        } else {
            TrackedState::Evicted(self.mtime)
        }
    }
}

/// Pure half of the nudge bookkeeping: the placeholders this round should
/// request downloads for. Only content the device *provably lacks* is
/// nudged — an item new to the snapshot (e.g. a note created on another
/// device), or one whose content-change date moved to a *known different*
/// date (a remote edit reaching an evicted item). Everything ambiguous
/// stays silent: an eviction of already-seen content, and any report
/// without a usable date on either side — re-downloading whatever the OS
/// just evicted turns Optimize Storage into a tug-of-war that keeps
/// `fileproviderd` pinned for as long as the app runs, and a genuinely
/// missed remote edit is caught by the reconcile's mtime comparison on
/// the next pass. Gather rounds never nudge (see `handle_notification`)
/// — open-path catch-up belongs to the reconcile's targeted
/// `icloud_request_downloads`, which consults the *index* rather than
/// this watch's session-local snapshot.
pub(super) fn plan_nudges(
    nudged: &mut HashMap<String, Option<u64>>,
    snapshot: &HashMap<String, TrackedState>,
    items: &[ItemState],
) -> Vec<String> {
    let mut request: Vec<String> = Vec::new();
    for item in items {
        if item.downloaded {
            nudged.remove(&item.rel);
            continue;
        }
        let missing = match snapshot.get(&item.rel) {
            None => true, // an arrival: content this device has never had
            Some(TrackedState::Local(mtime)) => item.mtime.is_some_and(|date| date != *mtime),
            Some(TrackedState::Evicted(previous)) => item
                .mtime
                .is_some_and(|date| previous.is_some_and(|prev| date != prev)),
        };
        if !missing || nudged.get(&item.rel) == Some(&item.mtime) {
            continue;
        }
        nudged.insert(item.rel.clone(), item.mtime);
        request.push(item.abs.clone());
    }
    request
}

/// Fold one round's items into the conflicted-path set: a reported item
/// enters or leaves by its flag, a removed item leaves. Pure, so the set
/// semantics are unit-testable next to [`apply_update_delta`]'s.
pub(super) fn apply_conflict_delta(
    conflicted: &mut HashSet<String>,
    upserted: &[ItemState],
    removed: &[String],
) {
    for item in upserted {
        if item.conflict {
            conflicted.insert(item.rel.clone());
        } else {
            conflicted.remove(&item.rel);
        }
    }
    for rel in removed {
        conflicted.remove(rel);
    }
}

/// Fold one round's conflict information into the live view, iff the
/// round belongs to the view's install epoch — a stale round from a
/// torn-down watch (an old query's gather completing late) must never
/// seed or poison a newer watch's view. A full listing (`rebuild`)
/// replaces the set wholesale and is the only round shape that may
/// declare the view gathered.
pub(super) fn fold_conflicts_into_view(
    view: &mut ConflictView,
    epoch: u64,
    upserted: &[ItemState],
    removed: &[String],
    rebuild: bool,
) {
    if view.epoch != epoch {
        return;
    }
    if rebuild {
        view.paths.clear();
    }
    apply_conflict_delta(&mut view.paths, upserted, removed);
    if rebuild {
        view.gathered = true;
    }
}

/// Apply a delta to the snapshot, returning the events to emit — the one
/// home of the diff rules (both the incremental update path and the
/// full-listing round route through it, kept free of Objective-C so it is
/// unit testable): upserts only for content that is **local**
/// (downloaded) and new or mtime-changed; removes only for paths gone
/// from the listing entirely; and an eviction (downloaded → placeholder)
/// is silent in both directions — eviction is not deletion, and its bytes
/// aren't local to upsert — until iCloud downloads the item again.
pub(super) fn apply_update_delta(
    snapshot: &mut HashMap<String, TrackedState>,
    upserted: &[ItemState],
    removed: &[String],
) -> Vec<FileChange> {
    let mut changes: Vec<FileChange> = Vec::new();
    for item in upserted {
        let state = item.snapshot_state();
        let previous = snapshot.insert(item.rel.clone(), state);
        let TrackedState::Local(mtime) = state else {
            continue; // placeholder (or eviction): bytes aren't local
        };
        if previous != Some(TrackedState::Local(mtime)) {
            changes.push(FileChange {
                path: item.rel.clone(),
                kind: "upsert".to_string(),
                modified_ms: Some(mtime),
            });
        }
    }
    for rel in removed {
        if snapshot.remove(rel).is_some() {
            changes.push(FileChange {
                path: rel.clone(),
                kind: "remove".to_string(),
                modified_ms: None,
            });
        }
    }
    changes
}

/// The watcher's note-tracking rule, over absolute metadata paths: an
/// eligible Markdown note anywhere visible (the shared
/// `reflect-graph-paths` policy), graph-relative. Tries every root
/// variant — Spotlight may report either side of the
/// `/var` ↔ `/private/var` symlink. Variants are slash-terminated
/// ([`root_variants`]), so the strip is a path boundary, not a string
/// prefix — a sibling `…/Notes-old/` can never masquerade as the graph.
pub(super) fn tracked_note_relpath(path: &str, roots: &[String]) -> Option<String> {
    let rel = roots
        .iter()
        .find_map(|root| path.strip_prefix(root.as_str()))?;
    reflect_graph_paths::is_note(rel).then(|| rel.to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        apply_conflict_delta, apply_update_delta, fold_conflicts_into_view, plan_nudges,
        root_variants, tracked_note_relpath, ConflictView, ItemState, TrackedState,
    };
    use std::collections::{HashMap, HashSet};

    fn state(entries: &[(&str, TrackedState)]) -> HashMap<String, TrackedState> {
        entries
            .iter()
            .map(|(rel, tracked)| (rel.to_string(), *tracked))
            .collect()
    }

    fn local(mtime: u64) -> TrackedState {
        TrackedState::Local(mtime)
    }

    fn evicted(mtime: Option<u64>) -> TrackedState {
        TrackedState::Evicted(mtime)
    }

    fn item(rel: &str, downloaded: bool, mtime: Option<u64>) -> ItemState {
        ItemState {
            rel: rel.to_string(),
            abs: format!("/container/Notes/{rel}"),
            downloaded,
            mtime,
            conflict: false,
        }
    }

    fn shapes(changes: &[super::FileChange]) -> Vec<(String, String, Option<u64>)> {
        let mut shapes: Vec<_> = changes
            .iter()
            .map(|change| (change.path.clone(), change.kind.clone(), change.modified_ms))
            .collect();
        shapes.sort();
        shapes
    }

    fn conflicted_item(rel: &str) -> ItemState {
        ItemState {
            conflict: true,
            ..item(rel, true, Some(1))
        }
    }

    #[test]
    fn a_stale_rounds_conflicts_never_reach_a_newer_view() {
        // The race: an old query's in-flight round completes after
        // teardown (epoch 0) or after a newer install (epoch 2). Either
        // way it must fold into nothing — a candidate sweep trusting a
        // poisoned or resurrected view would skip real conflicts.
        let mut view = ConflictView {
            epoch: 2,
            authoritative: true,
            gathered: false,
            paths: HashSet::new(),
        };
        fold_conflicts_into_view(&mut view, 1, &[conflicted_item("notes/a.md")], &[], true);
        assert!(!view.gathered, "a stale gather must not declare readiness");
        assert!(view.paths.is_empty());
    }

    #[test]
    fn a_current_rounds_rebuild_replaces_and_seeds_the_view() {
        let mut view = ConflictView {
            epoch: 3,
            authoritative: true,
            gathered: false,
            paths: HashSet::from(["notes/stale.md".to_string()]),
        };
        fold_conflicts_into_view(&mut view, 3, &[conflicted_item("notes/a.md")], &[], true);
        assert!(view.gathered);
        assert_eq!(view.paths, HashSet::from(["notes/a.md".to_string()]));

        // A later delta of the same epoch edits in place without
        // touching readiness.
        fold_conflicts_into_view(
            &mut view,
            3,
            &[item("notes/a.md", true, Some(2))],
            &["notes/b.md".to_string()],
            false,
        );
        assert!(view.gathered);
        assert!(view.paths.is_empty());
    }

    #[test]
    fn conflict_set_tracks_flags_across_rounds() {
        let mut conflicted: HashSet<String> = HashSet::new();
        let mut flagged = item("notes/a.md", true, Some(1));
        flagged.conflict = true;

        // A flagged report enters the set and stays across later rounds
        // that don't mention the path.
        apply_conflict_delta(&mut conflicted, std::slice::from_ref(&flagged), &[]);
        apply_conflict_delta(
            &mut conflicted,
            &[item("notes/other.md", true, Some(2))],
            &[],
        );
        assert!(conflicted.contains("notes/a.md"));

        // Resolution (the flag dropping) leaves the set…
        apply_conflict_delta(&mut conflicted, &[item("notes/a.md", true, Some(3))], &[]);
        assert!(!conflicted.contains("notes/a.md"));

        // …and so does the file disappearing from the listing.
        apply_conflict_delta(&mut conflicted, std::slice::from_ref(&flagged), &[]);
        apply_conflict_delta(&mut conflicted, &[], &["notes/a.md".to_string()]);
        assert!(conflicted.is_empty());
    }

    #[test]
    fn upserts_need_local_bytes_and_a_new_mtime() {
        // A full listing applied as a delta (how `full_round` uses it):
        // every listed item upserts, removes come precomputed.
        let mut snapshot = state(&[("notes/same.md", local(1))]);
        let listing = vec![
            item("notes/same.md", true, Some(1)),    // unchanged: no event
            item("notes/changed.md", true, Some(2)), // new content: upsert
            item("notes/stub.md", false, Some(9)),   // not downloaded: no event
        ];
        assert_eq!(
            shapes(&apply_update_delta(&mut snapshot, &listing, &[])),
            vec![(
                "notes/changed.md".to_string(),
                "upsert".to_string(),
                Some(2)
            )]
        );
    }

    #[test]
    fn eviction_is_not_deletion_but_disappearance_is() {
        let mut snapshot = state(&[
            ("notes/evicted.md", local(1)),
            ("notes/deleted.md", local(1)),
        ]);
        // The evicted note stays listed placeholder-state; the deleted one
        // is gone from the listing entirely.
        let listing = vec![item("notes/evicted.md", false, None)];
        let removed = vec!["notes/deleted.md".to_string()];
        assert_eq!(
            shapes(&apply_update_delta(&mut snapshot, &listing, &removed)),
            vec![("notes/deleted.md".to_string(), "remove".to_string(), None)]
        );
    }

    #[test]
    fn plan_nudges_requests_an_arrival_once() {
        let mut nudged: HashMap<String, Option<u64>> = HashMap::new();
        let snapshot = state(&[]);
        let stub = item("notes/a.md", false, Some(5));

        // First sighting of unknown content: request it. Every later
        // round with the same content date: already marked.
        assert_eq!(
            plan_nudges(&mut nudged, &snapshot, std::slice::from_ref(&stub)),
            vec!["/container/Notes/notes/a.md".to_string()]
        );
        assert!(plan_nudges(&mut nudged, &snapshot, std::slice::from_ref(&stub)).is_empty());

        // Completion clears the mark.
        let downloaded = item("notes/a.md", true, Some(5));
        assert!(plan_nudges(&mut nudged, &snapshot, std::slice::from_ref(&downloaded)).is_empty());
        assert!(!nudged.contains_key("notes/a.md"));
    }

    #[test]
    fn plan_nudges_leaves_evictions_alone() {
        // The OS evicted content we already saw locally: same content
        // date, bytes offloaded. Re-requesting it would fight Optimize
        // Storage — the eviction must be silent.
        let mut nudged: HashMap<String, Option<u64>> = HashMap::new();
        let snapshot = state(&[("notes/a.md", local(5))]);
        let evictee = item("notes/a.md", false, Some(5));
        assert!(plan_nudges(&mut nudged, &snapshot, std::slice::from_ref(&evictee)).is_empty());
    }

    #[test]
    fn plan_nudges_stays_silent_when_the_content_date_is_unknown() {
        let mut nudged: HashMap<String, Option<u64>> = HashMap::new();
        // An eviction reported without a content-change date must not
        // read as "missing" — that would re-request what the OS just
        // offloaded, the exact tug-of-war the policy forbids. A missed
        // real edit is caught by the reconcile's mtime comparison.
        let snapshot = state(&[("notes/a.md", local(5)), ("notes/b.md", evicted(None))]);
        let dateless = item("notes/a.md", false, None);
        assert!(plan_nudges(&mut nudged, &snapshot, std::slice::from_ref(&dateless)).is_empty());
        // A date appearing on an item whose previous date was unknown is
        // metadata arriving, not a provable remote edit — silent too.
        let dated = item("notes/b.md", false, Some(7));
        assert!(plan_nudges(&mut nudged, &snapshot, std::slice::from_ref(&dated)).is_empty());
    }

    #[test]
    fn plan_nudges_requests_a_remote_edit_reaching_an_evicted_item() {
        let mut nudged: HashMap<String, Option<u64>> = HashMap::new();
        // Already evicted at content date 5; the cloud now reports 7 — a
        // remote edit whose bytes this device lacks.
        let snapshot = state(&[("notes/a.md", evicted(Some(5)))]);
        let edited = item("notes/a.md", false, Some(7));
        assert_eq!(
            plan_nudges(&mut nudged, &snapshot, std::slice::from_ref(&edited)),
            vec!["/container/Notes/notes/a.md".to_string()]
        );
        // The same report again: already requested for date 7.
        let snapshot = state(&[("notes/a.md", evicted(Some(7)))]);
        assert!(plan_nudges(&mut nudged, &snapshot, std::slice::from_ref(&edited)).is_empty());
    }

    #[test]
    fn update_delta_applies_incrementally_with_the_same_rules() {
        let mut snapshot = state(&[
            ("notes/same.md", local(1)),
            ("notes/evictee.md", local(3)),
            ("notes/deleted.md", local(4)),
        ]);
        let upserted = vec![
            item("notes/same.md", true, Some(1)), // unchanged mtime: no event
            item("notes/changed.md", true, Some(2)), // new content: upsert
            item("notes/stub.md", false, Some(9)), // placeholder: tracked, silent
            item("notes/evictee.md", false, Some(3)), // eviction: silent, stays listed
        ];
        let removed = vec![
            "notes/deleted.md".to_string(),
            "notes/unknown.md".to_string(), // never tracked: no event
        ];
        let changes = apply_update_delta(&mut snapshot, &upserted, &removed);
        assert_eq!(
            shapes(&changes),
            vec![
                (
                    "notes/changed.md".to_string(),
                    "upsert".to_string(),
                    Some(2)
                ),
                ("notes/deleted.md".to_string(), "remove".to_string(), None),
            ]
        );
        // The snapshot now carries the delta: the placeholder and the
        // evictee as evicted (content dates preserved for the changed-only
        // nudge), the arrival's mtime, and no deleted row — exactly what
        // a later round must diff against.
        assert_eq!(
            snapshot,
            state(&[
                ("notes/same.md", local(1)),
                ("notes/changed.md", local(2)),
                ("notes/stub.md", evicted(Some(9))),
                ("notes/evictee.md", evicted(Some(3))),
            ])
        );
    }

    #[test]
    fn a_download_completion_in_an_update_upserts_once() {
        let mut snapshot = state(&[("notes/a.md", evicted(None))]);
        let changes = apply_update_delta(&mut snapshot, &[item("notes/a.md", true, Some(5))], &[]);
        assert_eq!(
            shapes(&changes),
            vec![("notes/a.md".to_string(), "upsert".to_string(), Some(5))]
        );
        // The same completion reported again (e.g. an attribute-only
        // change round) is snapshot-equal — no duplicate event.
        let changes = apply_update_delta(&mut snapshot, &[item("notes/a.md", true, Some(5))], &[]);
        assert!(changes.is_empty());
    }

    #[test]
    fn root_variants_are_slash_terminated_and_include_the_canonical_twin() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path().to_string_lossy().into_owned();
        let variants = root_variants(&root);
        assert_eq!(variants[0], format!("{root}/"));
        assert!(variants.iter().all(|variant| variant.ends_with('/')));
        // macOS tempdirs live behind the /var → /private/var symlink; the
        // canonical twin must be present (deduped when root is already
        // canonical).
        let canonical = std::fs::canonicalize(dir.path()).expect("canonicalize");
        let canonical = format!("{}/", canonical.to_string_lossy());
        assert!(variants.contains(&canonical));
        let unique: std::collections::BTreeSet<&String> = variants.iter().collect();
        assert_eq!(unique.len(), variants.len(), "variants must not repeat");
    }

    #[test]
    fn tracks_notes_relative_to_any_root_variant() {
        let roots = vec![
            "/var/mobile/Containers/Notes/".to_string(),
            "/private/var/mobile/Containers/Notes/".to_string(),
        ];
        // Spotlight may report the resolved (/private) side of the root
        // symlink; either variant must strip.
        assert_eq!(
            tracked_note_relpath("/var/mobile/Containers/Notes/daily/2026-07-04.md", &roots),
            Some("daily/2026-07-04.md".to_string())
        );
        assert_eq!(
            tracked_note_relpath("/private/var/mobile/Containers/Notes/notes/idea.md", &roots),
            Some("notes/idea.md".to_string())
        );
        assert_eq!(
            tracked_note_relpath("/var/mobile/Containers/Notes/.reflect/index.sqlite", &roots),
            None
        );
        assert_eq!(tracked_note_relpath("/elsewhere/notes/a.md", &roots), None);
        // A sibling directory sharing the root as a string prefix is not
        // inside the graph — the slash-terminated variant refuses it.
        assert_eq!(
            tracked_note_relpath("/var/mobile/Containers/Notes-old/notes/a.md", &roots),
            None
        );
    }
}
