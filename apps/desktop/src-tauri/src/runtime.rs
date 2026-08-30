//! The minimal durable runtime under agent runs (Plan 25 I07, the S3-minimal
//! slice): one process-wide run lock every edit-mode agent run takes — chat
//! turns and routines, across every window — a single durable in-flight
//! marker so a run killed with the app resurfaces as an interrupted attempt
//! on the next launch, and a native scheduler tick that keeps firing when a
//! hidden window's JS timers are throttled. Policy — dueness, retries, what
//! an interrupted run means — stays in `@reflect/core`; this module holds
//! only the primitives.

use std::collections::VecDeque;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{Emitter, Manager};
use tokio::sync::oneshot;

use crate::error::{AppError, AppResult};

// ---- run lock --------------------------------------------------------------

/// One lease in the run-lock queue: who holds (or waits), and from which
/// window, so a destroyed webview's leases die with it instead of wedging
/// every future run.
struct Lease {
    id: u64,
    window: String,
}

struct Waiter {
    lease: Lease,
    grant: oneshot::Sender<()>,
}

#[derive(Default)]
struct LockInner {
    next_id: u64,
    holder: Option<Lease>,
    queue: VecDeque<Waiter>,
}

impl LockInner {
    fn begin_acquire(&mut self, window: &str) -> (u64, Option<oneshot::Receiver<()>>) {
        self.next_id += 1;
        let id = self.next_id;
        let lease = Lease {
            id,
            window: window.to_string(),
        };
        if self.holder.is_none() && self.queue.is_empty() {
            self.holder = Some(lease);
            return (id, None);
        }
        let (grant, wait) = oneshot::channel();
        self.queue.push_back(Waiter { lease, grant });
        (id, Some(wait))
    }

    fn release(&mut self, id: u64) {
        if self.holder.as_ref().is_some_and(|lease| lease.id == id) {
            self.holder = None;
            self.advance();
            return;
        }
        self.queue.retain(|waiter| waiter.lease.id != id);
    }

    fn drop_window(&mut self, window: &str) {
        self.queue.retain(|waiter| waiter.lease.window != window);
        if self
            .holder
            .as_ref()
            .is_some_and(|lease| lease.window == window)
        {
            self.holder = None;
            self.advance();
        }
    }

    /// Hand the lock to the next waiter that is still listening. A waiter
    /// whose receiver is gone (its acquire future was dropped) is skipped —
    /// granting it would park the lock on nobody.
    fn advance(&mut self) {
        while let Some(waiter) = self.queue.pop_front() {
            let Waiter { lease, grant } = waiter;
            if grant.send(()).is_ok() {
                self.holder = Some(lease);
                return;
            }
        }
    }
}

/// The process-wide agent run lock. FIFO: leases are granted in acquire
/// order, one at a time. Deliberately not persisted — a restart has no runs,
/// so it starts unlocked.
#[derive(Default)]
pub struct AgentRunLockState {
    inner: Mutex<LockInner>,
}

impl AgentRunLockState {
    fn begin_acquire(&self, window: &str) -> (u64, Option<oneshot::Receiver<()>>) {
        self.inner
            .lock()
            .expect("agent run lock poisoned")
            .begin_acquire(window)
    }

    fn release(&self, id: u64) {
        self.inner
            .lock()
            .expect("agent run lock poisoned")
            .release(id);
    }

    /// Drop every lease a window holds or waits on. Called when the window
    /// is destroyed, and by the window's own fresh JS context at bootstrap —
    /// a reloaded webview can no longer release the leases its predecessor
    /// took.
    pub fn drop_window(&self, window: &str) {
        self.inner
            .lock()
            .expect("agent run lock poisoned")
            .drop_window(window);
    }
}

/// Command: take the process-wide agent run lease, waiting behind whoever
/// holds it. Resolves with the lease id to pass to
/// [`agent_run_lock_release`].
#[tauri::command]
pub async fn agent_run_lock_acquire(
    window: tauri::Window,
    state: tauri::State<'_, AgentRunLockState>,
) -> AppResult<u64> {
    let label = window.label().to_string();
    let (id, wait) = state.begin_acquire(&label);
    if let Some(wait) = wait {
        // A dropped sender means the lease was cancelled (its window died or
        // reset) before the grant — the caller's run must not start.
        wait.await
            .map_err(|_| AppError::io("the run-lock lease was cancelled before it was granted"))?;
    }
    Ok(id)
}

/// Command: release a lease taken by [`agent_run_lock_acquire`]. Idempotent —
/// releasing a lease that is gone (window reset already swept it) is a no-op.
/// Async to stay off the main thread; the body is an in-memory queue op.
#[tauri::command]
pub async fn agent_run_lock_release(
    lease_id: u64,
    state: tauri::State<'_, AgentRunLockState>,
) -> AppResult<()> {
    state.release(lease_id);
    Ok(())
}

/// Command: drop every lease this window holds or waits on. The webview
/// bootstrap calls it once per JS context: after a dev reload or crash the
/// new context cannot release its predecessor's leases, and without the
/// sweep the lock would stay wedged until the window closed.
/// Async to stay off the main thread; the body is an in-memory queue op.
#[tauri::command]
pub async fn agent_run_lock_reset(
    window: tauri::Window,
    state: tauri::State<'_, AgentRunLockState>,
) -> AppResult<()> {
    state.drop_window(window.label());
    Ok(())
}

// ---- in-flight routine marker ----------------------------------------------

/// The single durable in-flight slot. One is enough by construction: routine
/// runs hold the process-wide run lock, so two can never be in flight.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct InflightMarker {
    graph_root: String,
    routine_id: String,
    started_ms: i64,
}

/// What [`routine_run_inflight`] returns: the marker without its graph root —
/// the caller pinned a generation, so the root is theirs already, and a
/// marker belonging to another graph never crosses this boundary.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InflightRoutineRun {
    pub routine_id: String,
    pub started_ms: i64,
}

fn marker_path<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| AppError::io(format!("no app data dir: {err}")))?
        .join("runtime");
    Ok(dir.join("inflight-routine.json"))
}

/// A missing or unreadable marker is no marker: recovery is best-effort, and
/// a corrupt file must not brick the runner — the next save overwrites it.
fn load_marker(path: &Path) -> Option<InflightMarker> {
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

/// Persist (or clear, with `None`) the in-flight slot. Same temp-file +
/// rename dance as the settings store: a crash mid-write cannot truncate an
/// existing marker.
fn save_marker(path: &Path, marker: Option<&InflightMarker>) -> AppResult<()> {
    let Some(marker) = marker else {
        return match std::fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(err) => Err(AppError::io(err.to_string())),
        };
    };
    let dir = path
        .parent()
        .ok_or_else(|| AppError::io("inflight marker path has no parent directory"))?;
    std::fs::create_dir_all(dir)?;
    let json = serde_json::to_string(marker).map_err(|err| AppError::io(err.to_string()))?;
    let mut tmp = tempfile::NamedTempFile::new_in(dir)?;
    tmp.write_all(json.as_bytes())?;
    tmp.flush()?;
    tmp.persist(path)
        .map_err(|err| AppError::io(err.to_string()))?;
    Ok(())
}

/// Command: record that a routine run is in flight for the pinned graph.
/// Written before the run's engine starts, so a process death mid-run leaves
/// the marker for the next launch to recover.
#[tauri::command]
pub async fn routine_run_mark_started<R: tauri::Runtime>(
    generation: u64,
    routine_id: String,
    started_ms: i64,
    app: tauri::AppHandle<R>,
    graph: tauri::State<'_, crate::fs::GraphState>,
) -> AppResult<()> {
    let root = crate::fs::root_for_generation(&graph, generation)?;
    let path = marker_path(&app)?;
    let marker = InflightMarker {
        graph_root: root.to_string_lossy().into_owned(),
        routine_id,
        started_ms,
    };
    crate::blocking::run_blocking(move || save_marker(&path, Some(&marker))).await
}

/// Command: clear the in-flight slot — the run settled (success, failure, or
/// user stop alike; recovery is only for runs that never settled).
#[tauri::command]
pub async fn routine_run_mark_finished<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> AppResult<()> {
    let path = marker_path(&app)?;
    crate::blocking::run_blocking(move || save_marker(&path, None)).await
}

/// Command: the in-flight marker left by a previous process, if it belongs
/// to the pinned graph. A marker from another graph stays on disk untouched
/// (and unleaked) for that graph's own session to sweep.
#[tauri::command]
pub async fn routine_run_inflight<R: tauri::Runtime>(
    generation: u64,
    app: tauri::AppHandle<R>,
    graph: tauri::State<'_, crate::fs::GraphState>,
) -> AppResult<Option<InflightRoutineRun>> {
    let root = crate::fs::root_for_generation(&graph, generation)?;
    let path = marker_path(&app)?;
    let marker = crate::blocking::run_blocking(move || Ok(load_marker(&path))).await?;
    Ok(marker
        .filter(|marker| Path::new(&marker.graph_root) == root)
        .map(|marker| InflightRoutineRun {
            routine_id: marker.routine_id,
            started_ms: marker.started_ms,
        }))
}

// ---- native scheduler tick ---------------------------------------------------

/// The event the native tick emits to every webview. The routines runner
/// treats it exactly like its own interval firing.
pub const ROUTINE_TICK_EVENT: &str = "agent-routines:native-tick";

const ROUTINE_TICK_INTERVAL: Duration = Duration::from_secs(60);

/// Emit [`ROUTINE_TICK_EVENT`] every minute for the life of the process. The
/// webview's own `setInterval` is throttled (or suspended outright) while
/// its window is hidden under App Nap; an event from the native side arrives
/// through IPC and wakes it, so schedules keep firing with the window
/// closed.
pub fn spawn_routine_tick(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(ROUTINE_TICK_INTERVAL);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        // The first tick resolves immediately; launch is already covered by
        // the runner's own mount check.
        interval.tick().await;
        loop {
            interval.tick().await;
            let _ = app.emit(ROUTINE_TICK_EVENT, ());
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn granted(wait: &mut oneshot::Receiver<()>) -> bool {
        wait.try_recv().is_ok()
    }

    #[test]
    fn lock_grants_immediately_when_free_and_queues_fifo() {
        let mut inner = LockInner::default();
        let (first, wait) = inner.begin_acquire("main");
        assert!(wait.is_none());
        let (second, mut second_wait) = inner.begin_acquire("note-1");
        let (third, mut third_wait) = inner.begin_acquire("main");
        let mut second_wait_rx = second_wait.take().expect("second queues");
        let mut third_wait_rx = third_wait.take().expect("third queues");
        assert!(!granted(&mut second_wait_rx));
        inner.release(first);
        assert!(granted(&mut second_wait_rx));
        assert!(!granted(&mut third_wait_rx));
        inner.release(second);
        assert!(granted(&mut third_wait_rx));
        inner.release(third);
        assert!(inner.holder.is_none());
        assert!(inner.queue.is_empty());
    }

    #[test]
    fn releasing_a_queued_lease_removes_it_without_granting() {
        let mut inner = LockInner::default();
        let (first, _) = inner.begin_acquire("main");
        let (second, mut second_wait) = inner.begin_acquire("note-1");
        let (_, mut third_wait) = inner.begin_acquire("main");
        let mut second_wait_rx = second_wait.take().expect("second queues");
        let mut third_wait_rx = third_wait.take().expect("third queues");
        inner.release(second);
        inner.release(first);
        assert!(!granted(&mut second_wait_rx));
        assert!(granted(&mut third_wait_rx));
    }

    #[test]
    fn dropping_a_window_releases_its_hold_and_sweeps_its_waiters() {
        let mut inner = LockInner::default();
        let (_, _) = inner.begin_acquire("main");
        let (_, mut main_wait) = inner.begin_acquire("main");
        let (_, mut note_wait) = inner.begin_acquire("note-1");
        let mut main_wait_rx = main_wait.take().expect("main queues");
        let mut note_wait_rx = note_wait.take().expect("note queues");
        inner.drop_window("main");
        // The queued main lease is swept, so the note window goes next.
        assert!(!granted(&mut main_wait_rx));
        assert!(granted(&mut note_wait_rx));
    }

    #[test]
    fn advance_skips_waiters_whose_receiver_is_gone() {
        let mut inner = LockInner::default();
        let (first, _) = inner.begin_acquire("main");
        let (_, abandoned) = inner.begin_acquire("note-1");
        drop(abandoned);
        let (_, mut third_wait) = inner.begin_acquire("main");
        let mut third_wait_rx = third_wait.take().expect("third queues");
        inner.release(first);
        assert!(granted(&mut third_wait_rx));
    }

    #[test]
    fn marker_roundtrips_clears_and_shrugs_off_corruption() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("runtime").join("inflight-routine.json");
        assert!(load_marker(&path).is_none());
        let marker = InflightMarker {
            graph_root: "/vault".into(),
            routine_id: "r1".into(),
            started_ms: 1_234,
        };
        save_marker(&path, Some(&marker)).expect("save");
        let loaded = load_marker(&path).expect("marker present");
        assert_eq!(loaded.routine_id, "r1");
        assert_eq!(loaded.graph_root, "/vault");
        assert_eq!(loaded.started_ms, 1_234);
        std::fs::write(&path, "{not json").expect("corrupt");
        assert!(load_marker(&path).is_none());
        save_marker(&path, None).expect("clear");
        assert!(!path.exists());
        save_marker(&path, None).expect("clearing twice is fine");
    }
}
