//! The real `NSMetadataQuery` wiring — everything Objective-C touches. The
//! pure diff/nudge rules this drives live in [`super::state`] so they stay
//! unit testable off this Objective-C surface.

use std::collections::{HashMap, HashSet};
use std::ptr::NonNull;
use std::sync::{LazyLock, Mutex};

use block2::RcBlock;
use dispatch2::MainThreadBound;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{msg_send, MainThreadMarker};
use objc2_foundation::{
    NSArray, NSCopying, NSDate, NSMetadataItem, NSMetadataItemFSContentChangeDateKey,
    NSMetadataItemPathKey, NSMetadataQuery, NSMetadataQueryDidFinishGatheringNotification,
    NSMetadataQueryDidUpdateNotification, NSMetadataQueryUbiquitousDocumentsScope,
    NSMetadataQueryUpdateAddedItemsKey, NSMetadataQueryUpdateChangedItemsKey,
    NSMetadataQueryUpdateRemovedItemsKey, NSMetadataUbiquitousItemDownloadingStatusCurrent,
    NSMetadataUbiquitousItemDownloadingStatusKey,
    NSMetadataUbiquitousItemHasUnresolvedConflictsKey, NSNotification, NSNotificationCenter,
    NSNumber, NSOperationQueue, NSPredicate, NSString,
};
use tauri::{Emitter, Manager};

use crate::error::{AppError, AppResult};

use super::state;

/// How long the query buckets live updates before delivering one
/// `DidUpdate` notification. During an initial mass download thousands of
/// files flip to current one by one; without an explicit interval each
/// flip can arrive as its own notification, and every notification costs
/// a JS `index:changed` round downstream. Two seconds keeps "a Mac edit
/// appears in seconds" while collapsing a download burst into a handful
/// of batches.
const UPDATE_BATCHING_INTERVAL_S: f64 = 2.0;

/// The live query plus everything that must stay alive (and on the main
/// thread) with it.
struct Watch {
    query: Retained<NSMetadataQuery>,
    /// Never read — held so the delivery queue outlives the query.
    _queue: Retained<NSOperationQueue>,
    tokens: Vec<Retained<AnyObject>>,
}

/// The active watch, pinned to the main thread. `MainThreadBound` keeps
/// the non-`Send` Objective-C handles sound inside a global.
static ACTIVE: Mutex<Option<MainThreadBound<Watch>>> = Mutex::new(None);

/// Last reported state per graph-relative path. Plain Rust — safe to
/// touch from the delivery queue.
static SNAPSHOT: LazyLock<Mutex<HashMap<String, state::TrackedState>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// The live [`state::ConflictView`]. Install epochs start at 1, so the default
/// view (epoch 0) can never accept a round.
static CONFLICT_VIEW: LazyLock<Mutex<state::ConflictView>> =
    LazyLock::new(|| Mutex::new(state::ConflictView::default()));

/// Content-change date last download-requested, per graph-relative path.
/// The OS treats repeat requests as no-ops, but *issuing* them is not
/// free: during an initial sync every update round used to re-request
/// every still-pending placeholder — O(N) `NSFileManager` calls per
/// round, O(N²) across a large download. Each (path, date) is requested
/// once; completion (or removal from the listing) clears the entry. A
/// download that silently stalls is retried by the resume-path
/// `icloud_download_pending` walk, which requests unconditionally.
static NUDGED: LazyLock<Mutex<HashMap<String, Option<u64>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Lifecycle epoch: every `start`/`stop` bumps it, and a queued install
/// only proceeds when its epoch is still current. Commands run off the
/// main thread while installs run *on* it, so without this a second
/// `start` could slip in before the first's install executed — `stop`
/// would find `ACTIVE` still empty, and the first query would leak,
/// its observers emitting events for the wrong graph root forever
/// (dropping observer tokens does not deregister them).
static EPOCH: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

pub fn start(
    app: tauri::AppHandle,
    root: String,
    emit_file_changes: bool,
    authoritative: bool,
) -> AppResult<()> {
    use std::sync::atomic::Ordering;
    let epoch = EPOCH.fetch_add(1, Ordering::SeqCst) + 1;
    let handle = app.clone();
    app.run_on_main_thread(move || install(handle, root, emit_file_changes, authoritative, epoch))
        .map_err(|err| AppError::io(format!("failed to reach the main thread: {err}")))
}

pub fn stop(app: tauri::AppHandle) -> AppResult<()> {
    use std::sync::atomic::Ordering;
    // Invalidate any queued-but-not-yet-run install…
    EPOCH.fetch_add(1, Ordering::SeqCst);
    // …and tear down whatever is actually live, on the main thread —
    // where installs also run, so the two can never interleave.
    app.run_on_main_thread(move || {
        let mtm = MainThreadMarker::new().expect("run_on_main_thread is the main thread");
        teardown_active(mtm);
    })
    .map_err(|err| AppError::io(format!("failed to reach the main thread: {err}")))
}

/// Stop and deregister the live watch, if any. Main thread only — every
/// caller is a main-thread closure, which is what serializes teardown
/// against installs.
fn teardown_active(mtm: MainThreadMarker) {
    // A stopped watch must answer "unknown", never "no conflicts".
    *CONFLICT_VIEW.lock().expect("conflict view lock") = state::ConflictView::default();
    let Some(bound) = ACTIVE.lock().expect("watch lock").take() else {
        return;
    };
    let watch = bound.into_inner(mtm);
    watch.query.stopQuery();
    let center = NSNotificationCenter::defaultCenter();
    for token in &watch.tokens {
        unsafe {
            let _: () = msg_send![&center, removeObserver: &**token];
        }
    }
}

/// Build, wire, and start the query. Main thread only. Tears down any
/// live watch first (installs and stops all run here, serially), and
/// aborts when a later `start`/`stop` has superseded this one's epoch —
/// so rapid graph switches can never leave two queries running or
/// install a watch after its graph closed.
fn install(
    app: tauri::AppHandle,
    root: String,
    emit_file_changes: bool,
    authoritative: bool,
    epoch: u64,
) {
    use std::sync::atomic::Ordering;
    let mtm = MainThreadMarker::new().expect("run_on_main_thread is the main thread");
    teardown_active(mtm);
    if EPOCH.load(Ordering::SeqCst) != epoch {
        return; // superseded while queued — a newer install/stop owns the lifecycle
    }
    SNAPSHOT.lock().expect("snapshot lock").clear();
    NUDGED.lock().expect("nudge lock").clear();
    *CONFLICT_VIEW.lock().expect("conflict view lock") = state::ConflictView {
        epoch,
        authoritative,
        gathered: false,
        paths: HashSet::new(),
    };
    let query = NSMetadataQuery::new();
    query.setNotificationBatchingInterval(UPDATE_BATCHING_INTERVAL_S);

    let scope: Retained<NSString> = unsafe { NSMetadataQueryUbiquitousDocumentsScope.copy() };
    let scopes = NSArray::from_retained_slice(&[scope]);
    // setSearchScopes/argumentArray take untyped NSArrays the bindings
    // can't coerce typed arrays into — message directly.
    unsafe {
        let _: () = msg_send![&query, setSearchScopes: &*scopes];
    }

    let roots = state::root_variants(&root);
    let path_key: Retained<NSString> = unsafe { NSMetadataItemPathKey.copy() };
    let format = NSString::from_str(
        &(0..roots.len())
            .map(|_| "(%K BEGINSWITH %@)")
            .collect::<Vec<_>>()
            .join(" OR "),
    );
    let mut arg_list: Vec<Retained<NSString>> = Vec::new();
    for variant in &roots {
        arg_list.push(path_key.copy());
        arg_list.push(NSString::from_str(variant));
    }
    let args = NSArray::from_retained_slice(&arg_list);
    let predicate: Retained<NSPredicate> = unsafe {
        msg_send![
            objc2::class!(NSPredicate),
            predicateWithFormat: &*format,
            argumentArray: &*args
        ]
    };
    query.setPredicate(Some(&predicate));

    let queue = NSOperationQueue::new();
    // Must stay serial: CloudDocs (BRQuery) schedules its own internal,
    // unsynchronized gatherer work on this queue — not just notification
    // delivery. On the default concurrent queue the initial gather and
    // update batches classify items in parallel and corrupt BRQuery's
    // result index sets, aborting with an uncaught NSRangeException
    // (crash: NSMutableIndexSet addIndexesInRange in
    // _handleReplacedItemsNotifications, ~10s after launch).
    queue.setMaxConcurrentOperationCount(1);
    unsafe { query.setOperationQueue(Some(&queue)) };

    let handler_roots = roots.clone();
    let emit_app = app.clone();
    let block = RcBlock::new(move |notification: NonNull<NSNotification>| {
        handle_notification(&app, &handler_roots, emit_file_changes, epoch, notification);
    });
    let center = NSNotificationCenter::defaultCenter();
    let query_object: &AnyObject = &query;
    let mut tokens = Vec::new();
    for name in [
        unsafe { NSMetadataQueryDidFinishGatheringNotification },
        unsafe { NSMetadataQueryDidUpdateNotification },
    ] {
        let token: Retained<AnyObject> = unsafe {
            msg_send![
                &center,
                addObserverForName: name,
                object: query_object,
                queue: &*queue,
                usingBlock: &*block
            ]
        };
        tokens.push(token);
    }

    if !query.startQuery() {
        // Per Apple docs this means "already running" or "no predicate" —
        // neither can happen for this fresh, predicated query, but if it
        // ever does, an installed-but-dead watch would silently eat the
        // stop/start lifecycle. Tear the observers down and leave ACTIVE
        // empty instead; the controller's resume-triggered sweeps keep
        // conflict handling alive without the query. (The install runs
        // fire-and-forget on the main thread, so the command has already
        // returned — an error can't reach the caller from here.)
        tracing::warn!("iCloud metadata query failed to start; falling back to sweep triggers");
        let center = NSNotificationCenter::defaultCenter();
        for token in &tokens {
            unsafe {
                let _: () = msg_send![&center, removeObserver: &**token];
            }
        }
        // The command returned long ago (this closure is fire-and-forget
        // on the main thread), so surface the failure as an event: the
        // controller logs it loudly and runs an immediate fallback sweep
        // — on iOS the query is the sole live change source, and a
        // silently dead watch would otherwise read as "no changes".
        let _ = emit_app.emit("icloud:watch-failed", ());
        return;
    }
    *ACTIVE.lock().expect("watch lock") = Some(MainThreadBound::new(
        Watch {
            query,
            _queue: queue,
            tokens,
        },
        mtm,
    ));
}

/// Extract the tracked state from one metadata item; `None` for items
/// outside the graph's note directories.
fn item_state(item: &NSMetadataItem, roots: &[String]) -> Option<state::ItemState> {
    let abs = attr_string(item, unsafe { NSMetadataItemPathKey })?;
    let rel = state::tracked_note_relpath(&abs, roots)?;
    let downloaded = attr_string(item, unsafe {
        NSMetadataUbiquitousItemDownloadingStatusKey
    })
    .is_some_and(|status| {
        status == unsafe { NSMetadataUbiquitousItemDownloadingStatusCurrent }.to_string()
    });
    let mtime = attr_date_ms(item, unsafe { NSMetadataItemFSContentChangeDateKey });
    let conflict = attr_bool(item, unsafe {
        NSMetadataUbiquitousItemHasUnresolvedConflictsKey
    });
    Some(state::ItemState {
        rel,
        abs,
        downloaded,
        mtime,
        conflict,
    })
}

/// What one notification round produced: the file events to emit and the
/// paths the provider reports as conflicted.
struct Round {
    changes: Vec<state::FileChange>,
    conflicts: Vec<String>,
}

/// Request downloads for the placeholders [`state::plan_nudges`] marked. Must
/// run *before* the round's delta folds into [`SNAPSHOT`] — the plan
/// compares against the previous states.
fn nudge_pending(items: &[state::ItemState]) {
    let request = {
        let snapshot = SNAPSHOT.lock().expect("snapshot lock");
        let mut nudged = NUDGED.lock().expect("nudge lock");
        state::plan_nudges(&mut nudged, &snapshot, items)
    };
    for abs in request {
        crate::icloud::storage::request_download(std::path::Path::new(&abs));
    }
}

/// The items the provider flags as carrying unresolved conflict versions.
fn conflicted_rels(items: &[state::ItemState]) -> Vec<String> {
    items
        .iter()
        .filter(|item| item.conflict)
        .map(|item| item.rel.clone())
        .collect()
}

/// The scoped sweep's candidate set — see the outer
/// [`super::conflicted_paths`] for the contract. One lock read: the
/// trust conditions and the paths come from the same view, and the
/// epoch check also covers "the watch was stopped but its main-thread
/// teardown hasn't run yet" (stop bumps [`EPOCH`] synchronously).
pub(crate) fn conflicted_paths() -> Option<HashSet<String>> {
    use std::sync::atomic::Ordering;
    let view = CONFLICT_VIEW.lock().expect("conflict view lock");
    (view.authoritative && view.gathered && view.epoch == EPOCH.load(Ordering::SeqCst))
        .then(|| view.paths.clone())
}

/// One gathering/update round. Updates apply the notification's own
/// added/changed/removed delta — O(changed items); a full results
/// enumeration here would be O(all items) per round, O(n²) across an
/// initial mass download. The gather round (and an update without a
/// usable delta) still snapshots the full listing.
fn handle_notification(
    app: &tauri::AppHandle,
    roots: &[String],
    emit_file_changes: bool,
    epoch: u64,
    notification: NonNull<NSNotification>,
) {
    let notification = unsafe { notification.as_ref() };
    let Some(object) = notification.object() else {
        return;
    };
    let Ok(query) = object.downcast::<NSMetadataQuery>() else {
        return;
    };

    let is_update = &*notification.name() == unsafe { NSMetadataQueryDidUpdateNotification };
    let round = if is_update {
        match update_delta(notification, roots) {
            Some((upserted, removed)) => update_round(&upserted, &removed, epoch),
            None => full_round(&query, roots, true, epoch),
        }
    } else {
        // The gather round: this watch just started, with an empty
        // snapshot — every placeholder would compare as "new". Nudging
        // here used to re-request every evicted file in the graph on
        // every app open, an unpaced download storm that pinned
        // fileproviderd. The reconcile's targeted downloads own
        // open-path catch-up; this round only seeds the snapshot.
        full_round(&query, roots, false, epoch)
    };

    if !round.changes.is_empty() {
        // The listing cache must not outlive a change this round observed
        // (a download materialized, a Mac-side edit landed). Try every
        // root variant: invalidation is root-checked, so the one matching
        // the open graph wins and the others are no-ops.
        let state = app.state::<crate::fs::GraphState>();
        for root in roots {
            let root = std::path::Path::new(root.trim_end_matches('/'));
            crate::fs::invalidate_file_catalog(&state, root);
        }
        if emit_file_changes && is_update {
            let _ = app.emit("index:changed", round.changes);
        }
    }
    if emit_file_changes && !is_update {
        // The gather round diffs against an empty snapshot, so its
        // "changes" are every downloaded note in the graph — not news,
        // just the watch coming up. Emitting them sent an O(graph)
        // payload through every index:changed listener on each open.
        // The open-path reconcile already covers on-disk state; one
        // coarse reconcile signal (coalesced by the frontend) closes the
        // window between its listing and the gather completing. Emitted
        // regardless of the round's diff: what raced in may be invisible
        // to it — a deletion leaves the empty-snapshot diff empty, and
        // placeholders never appear as changes at all — so an empty
        // gather proves nothing about that window.
        let _ = app.emit(crate::watcher::RECONCILE_EVENT, ());
    }
    if !round.conflicts.is_empty() {
        let mut conflicts = round.conflicts;
        conflicts.sort();
        let _ = app.emit("icloud:conflicts", conflicts);
    }
}

/// Apply one update notification's delta: nudge placeholders whose
/// content this device lacks, fold the delta into the snapshot, and drop
/// nudge marks for removed items.
fn update_round(upserted: &[state::ItemState], removed: &[String], epoch: u64) -> Round {
    nudge_pending(upserted);
    let changes = {
        let mut snapshot = SNAPSHOT.lock().expect("snapshot lock");
        state::apply_update_delta(&mut snapshot, upserted, removed)
    };
    {
        let mut nudged = NUDGED.lock().expect("nudge lock");
        for rel in removed {
            nudged.remove(rel);
        }
    }
    {
        let mut view = CONFLICT_VIEW.lock().expect("conflict view lock");
        state::fold_conflicts_into_view(&mut view, epoch, upserted, removed, false);
    }
    Round {
        changes,
        conflicts: conflicted_rels(upserted),
    }
}

/// Snapshot the query's full results listing — the gather round (`nudge:
/// false`), and the fallback for an update notification without a usable
/// delta (`nudge: true`; the gather already seeded the snapshot, so the
/// changed-only comparison works). Expressed through
/// [`state::apply_update_delta`] (every listed item as an upsert, every
/// snapshot row missing from the listing as a remove) so the full and
/// incremental paths share one set of diff rules and can never drift.
fn full_round(query: &NSMetadataQuery, roots: &[String], nudge: bool, epoch: u64) -> Round {
    query.disableUpdates();
    let results = query.results();
    let mut items: Vec<state::ItemState> = Vec::new();
    for item in results.iter() {
        let Ok(item) = item.downcast::<NSMetadataItem>() else {
            continue;
        };
        if let Some(state) = item_state(&item, roots) {
            items.push(state);
        }
    }
    query.enableUpdates();

    if nudge {
        nudge_pending(&items);
    }
    let listed: HashSet<&str> = items.iter().map(|item| item.rel.as_str()).collect();
    {
        // Placeholders that vanished from the listing can't complete —
        // drop their nudge marks along with the snapshot rows.
        let mut nudged = NUDGED.lock().expect("nudge lock");
        nudged.retain(|rel, _| listed.contains(rel.as_str()));
    }
    let changes = {
        let mut snapshot = SNAPSHOT.lock().expect("snapshot lock");
        let removed: Vec<String> = snapshot
            .keys()
            .filter(|rel| !listed.contains(rel.as_str()))
            .cloned()
            .collect();
        state::apply_update_delta(&mut snapshot, &items, &removed)
    };
    {
        // A full listing is authoritative — rebuild the set wholesale;
        // only a full listing may declare the view complete, and only
        // for the epoch it belongs to.
        let mut view = CONFLICT_VIEW.lock().expect("conflict view lock");
        state::fold_conflicts_into_view(&mut view, epoch, &items, &[], true);
    }
    Round {
        changes,
        conflicts: conflicted_rels(&items),
    }
}

/// The added/changed/removed items an update notification carries in its
/// `userInfo`. `None` when the dictionary is missing entirely (fall back
/// to a full round); empty arrays are a real "nothing tracked changed".
fn update_delta(
    notification: &NSNotification,
    roots: &[String],
) -> Option<(Vec<state::ItemState>, Vec<String>)> {
    let info = notification.userInfo()?;
    let items_for = |key: &NSString| -> Vec<Retained<NSMetadataItem>> {
        let value: Option<Retained<AnyObject>> = unsafe { msg_send![&*info, objectForKey: key] };
        let Some(value) = value else {
            return Vec::new();
        };
        let Ok(array) = value.downcast::<NSArray>() else {
            return Vec::new();
        };
        array
            .iter()
            .filter_map(|item| item.downcast::<NSMetadataItem>().ok())
            .collect()
    };
    let mut upserted: Vec<state::ItemState> = Vec::new();
    for key in [unsafe { NSMetadataQueryUpdateAddedItemsKey }, unsafe {
        NSMetadataQueryUpdateChangedItemsKey
    }] {
        for item in items_for(key) {
            if let Some(state) = item_state(&item, roots) {
                upserted.push(state);
            }
        }
    }
    let removed: Vec<String> = items_for(unsafe { NSMetadataQueryUpdateRemovedItemsKey })
        .iter()
        .filter_map(|item| {
            let path = attr_string(item, unsafe { NSMetadataItemPathKey })?;
            state::tracked_note_relpath(&path, roots)
        })
        .collect();
    Some((upserted, removed))
}

/// A metadata attribute as a string; `None` when absent or another type.
fn attr_string(item: &NSMetadataItem, key: &NSString) -> Option<String> {
    let value = item.valueForAttribute(key)?;
    value.downcast::<NSString>().ok().map(|s| s.to_string())
}

/// A boolean metadata attribute; absent or non-numeric reads as `false`.
fn attr_bool(item: &NSMetadataItem, key: &NSString) -> bool {
    item.valueForAttribute(key)
        .and_then(|value| value.downcast::<NSNumber>().ok())
        .map(|number| number.boolValue())
        .unwrap_or(false)
}

/// A date metadata attribute as epoch ms, clamped at 0 for pre-epoch dates.
fn attr_date_ms(item: &NSMetadataItem, key: &NSString) -> Option<u64> {
    let date = item.valueForAttribute(key)?.downcast::<NSDate>().ok()?;
    let seconds = date.timeIntervalSince1970();
    if seconds <= 0.0 {
        return Some(0);
    }
    Some((seconds * 1000.0) as u64)
}
