//! Script-mode routine ticks (the silent tick): run one user-authored shell
//! command in the graph root, bounded by a timeout, and hand the frontend
//! its exit code and capped output. The *interpretation* — skip, wake the
//! agent, or count a failure — lives in `@reflect/core`'s `routine-script`;
//! this module only owns the process: spawn, drain, deadline, kill.
//!
//! The script runs in its own process group so the timeout can kill the
//! whole tree — `sh -c` scripts spawn children, and killing only the shell
//! would leave grandchildren running past the tick. `process_tree` owns that
//! sequence (terminate, grace, kill, reap).

use std::collections::HashMap;
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{Manager, State};

use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::process_tree;

/// Cap on each captured stream — a runaway script can't balloon memory.
const OUTPUT_LIMIT: usize = 64 * 1024;
/// Timeout bounds: the frontend asks, this clamps.
const DEFAULT_TIMEOUT_MS: u64 = 30_000;
const MAX_TIMEOUT_MS: u64 = 120_000;
/// Poll interval for the deadline loop.
const POLL_MS: u64 = 50;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptTickOutcome {
    /// Exit code; `None` when the process died to a signal (timeout kill).
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
}

/// Prepared cancellation slots, registered before the caller can request Stop.
#[derive(Default)]
pub struct RoutineScriptState(Mutex<HashMap<String, (Arc<AtomicBool>, bool)>>);

impl RoutineScriptState {
    pub fn cancel_all(&self) {
        if let Ok(slots) = self.0.lock() {
            for (cancelled, _) in slots.values() {
                cancelled.store(true, Ordering::SeqCst);
            }
        }
    }
}

#[tauri::command]
pub fn routine_script_prepare(
    request_id: String,
    state: State<'_, RoutineScriptState>,
) -> AppResult<()> {
    let mut slots = state
        .0
        .lock()
        .map_err(|_| AppError::io("script state poisoned"))?;
    if request_id.is_empty() || request_id.len() > 128 || slots.contains_key(&request_id) {
        return Err(AppError::io("invalid or duplicate script request"));
    }
    slots.insert(request_id, (Arc::new(AtomicBool::new(false)), false));
    Ok(())
}

#[tauri::command]
pub fn routine_script_stop(
    request_id: String,
    state: State<'_, RoutineScriptState>,
) -> AppResult<()> {
    if let Some((cancelled, _)) = state
        .0
        .lock()
        .map_err(|_| AppError::io("script state poisoned"))?
        .get(&request_id)
    {
        cancelled.store(true, Ordering::SeqCst);
    }
    Ok(())
}

/// Run the prepared script in the generation-pinned graph, then release its slot.
#[tauri::command]
pub async fn routine_script_run<R: tauri::Runtime>(
    request_id: String,
    command: String,
    generation: u64,
    timeout_ms: Option<u64>,
    app: tauri::AppHandle<R>,
) -> AppResult<ScriptTickOutcome> {
    let cancelled = {
        let state = app.state::<RoutineScriptState>();
        let mut slots = state
            .0
            .lock()
            .map_err(|_| AppError::io("script state poisoned"))?;
        let (cancelled, running) = slots
            .get_mut(&request_id)
            .ok_or_else(|| AppError::io("script was not prepared"))?;
        if *running {
            return Err(AppError::io("script is already running"));
        }
        *running = true;
        Arc::clone(cancelled)
    };
    let worker_app = app.clone();
    let outcome = crate::blocking::run_blocking(move || {
        let root = crate::fs::root_for_generation(
            &worker_app.state::<crate::fs::GraphState>(),
            generation,
        )?;
        run_script(&command, &root.to_string_lossy(), timeout_ms, &cancelled)
    })
    .await;
    app.state::<RoutineScriptState>()
        .0
        .lock()
        .map_err(|_| AppError::io("script state poisoned"))?
        .remove(&request_id);
    outcome
}

fn run_script(
    script: &str,
    cwd: &str,
    timeout_ms: Option<u64>,
    cancelled: &AtomicBool,
) -> AppResult<ScriptTickOutcome> {
    if cancelled.load(Ordering::SeqCst) {
        return Err(AppError::io("script stopped"));
    }
    if script.trim().is_empty() {
        return Err(AppError::io("the routine script is empty"));
    }
    let timeout =
        Duration::from_millis(timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS).min(MAX_TIMEOUT_MS));

    let mut command = shell_command(script);
    let mut child = command
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| AppError::io(format!("could not start the routine script: {err}")))?;

    // Capped drains on their own threads: waiting for the deadline while a
    // chatty script fills a pipe nobody reads would deadlock the child.
    let stdout = drain_capped(child.stdout.take());
    let stderr = drain_capped(child.stderr.take());

    let deadline = Instant::now() + timeout;
    let mut timed_out = false;
    let code = loop {
        if cancelled.load(Ordering::SeqCst) {
            process_tree::terminate_tree(&mut child);
            return Err(AppError::io("script stopped"));
        }
        match child.try_wait() {
            Ok(Some(status)) if stdout.is_finished() && stderr.is_finished() => {
                break status.code()
            }
            Ok(_) => {}
            Err(err) => {
                process_tree::terminate_tree(&mut child);
                return Err(AppError::io(format!(
                    "could not wait for the script: {err}"
                )));
            }
        }
        if Instant::now() >= deadline {
            timed_out = true;
            break None;
        }
        std::thread::sleep(Duration::from_millis(POLL_MS));
    };
    // Also sweep descendants of a shell that exited before its children.
    process_tree::terminate_tree(&mut child);
    let drain_deadline = Instant::now() + Duration::from_millis(250);
    while !(stdout.is_finished() && stderr.is_finished()) && Instant::now() < drain_deadline {
        std::thread::sleep(Duration::from_millis(POLL_MS));
    }

    Ok(ScriptTickOutcome {
        code,
        stdout: if stdout.is_finished() {
            stdout.join().unwrap_or_default()
        } else {
            String::new()
        },
        stderr: if stderr.is_finished() {
            stderr.join().unwrap_or_default()
        } else {
            String::new()
        },
        timed_out,
    })
}

/// `sh -c` on Unix, `cmd /C` elsewhere — in its own process group, so the
/// timeout kill reaches the whole tree (see module docs and `process_tree`).
fn shell_command(script: &str) -> Command {
    #[cfg(unix)]
    let mut command = {
        let mut shell = Command::new("/bin/sh");
        shell.arg("-c").arg(script);
        shell
    };
    #[cfg(not(unix))]
    let mut command = {
        let mut shell = Command::new("cmd");
        shell.arg("/C").arg(script);
        shell
    };
    process_tree::own_process_group(&mut command);
    command
}

/// Read a pipe to EOF on its own thread, keeping only the first
/// `OUTPUT_LIMIT` bytes but draining the rest so the child never blocks.
fn drain_capped<R: Read + Send + 'static>(pipe: Option<R>) -> std::thread::JoinHandle<String> {
    std::thread::spawn(move || {
        let mut kept: Vec<u8> = Vec::new();
        if let Some(mut pipe) = pipe {
            let mut chunk = [0_u8; 8192];
            loop {
                match pipe.read(&mut chunk) {
                    Ok(0) | Err(_) => break,
                    Ok(read) => {
                        if kept.len() < OUTPUT_LIMIT {
                            let take = read.min(OUTPUT_LIMIT - kept.len());
                            kept.extend_from_slice(&chunk[..take]);
                        }
                    }
                }
            }
        }
        String::from_utf8_lossy(&kept).into_owned()
    })
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    fn run_script(script: &str, cwd: &str, timeout: Option<u64>) -> AppResult<ScriptTickOutcome> {
        super::run_script(script, cwd, timeout, &AtomicBool::new(false))
    }

    #[test]
    fn background_child_cannot_hold_the_pipes_past_the_deadline() {
        let started = Instant::now();
        let outcome = run_script("sleep 30 &", &tmp(), Some(100)).unwrap();
        assert!(outcome.timed_out);
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[test]
    fn stop_terminates_the_script_before_its_deadline() {
        let cancelled = Arc::new(AtomicBool::new(false));
        let request = Arc::clone(&cancelled);
        let worker =
            std::thread::spawn(move || super::run_script("sleep 30", &tmp(), None, &request));
        std::thread::sleep(Duration::from_millis(100));
        let started = Instant::now();
        cancelled.store(true, Ordering::SeqCst);
        assert!(worker.join().unwrap().is_err());
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    fn tmp() -> String {
        std::env::temp_dir().to_string_lossy().into_owned()
    }

    #[test]
    fn quiet_success_returns_zero_and_empty_output() {
        let outcome = run_script("true", &tmp(), None).unwrap();
        assert_eq!(outcome.code, Some(0));
        assert_eq!(outcome.stdout, "");
        assert!(!outcome.timed_out);
    }

    #[test]
    fn output_and_exit_codes_pass_through() {
        let outcome = run_script("echo hello; echo oops >&2; exit 3", &tmp(), None).unwrap();
        assert_eq!(outcome.code, Some(3));
        assert_eq!(outcome.stdout.trim(), "hello");
        assert_eq!(outcome.stderr.trim(), "oops");
    }

    #[test]
    fn a_stalling_script_is_killed_at_the_deadline() {
        let started = Instant::now();
        let outcome = run_script("sleep 30", &tmp(), Some(250)).unwrap();
        assert!(outcome.timed_out);
        assert_eq!(outcome.code, None);
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[test]
    fn an_empty_script_is_refused() {
        assert!(run_script("   ", &tmp(), None).is_err());
    }

    #[test]
    fn oversized_output_is_capped_without_hanging() {
        // ~1MB of output, far past the cap — must drain, not deadlock.
        let outcome = run_script("yes x | head -c 1000000", &tmp(), None).unwrap();
        assert_eq!(outcome.code, Some(0));
        assert_eq!(outcome.stdout.len(), OUTPUT_LIMIT);
    }
}
