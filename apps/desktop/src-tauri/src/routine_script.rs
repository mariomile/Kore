//! Script-mode routine ticks (the silent tick): run one user-authored shell
//! command in the graph root, bounded by a timeout, and hand the frontend
//! its exit code and capped output. The *interpretation* — skip, wake the
//! agent, or count a failure — lives in `@reflect/core`'s `routine-script`;
//! this module only owns the process: spawn, drain, deadline, kill.
//!
//! The script runs in its own process group so the timeout can kill the
//! whole tree — `sh -c` scripts spawn children, and killing only the shell
//! would leave grandchildren running past the tick.

use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::error::{AppError, AppResult};

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

/// Run one routine script to completion (or its deadline) and report.
#[tauri::command]
pub async fn routine_script_run(
    command: String,
    cwd: String,
    timeout_ms: Option<u64>,
) -> AppResult<ScriptTickOutcome> {
    crate::blocking::run_blocking(move || run_script(&command, &cwd, timeout_ms)).await
}

fn run_script(script: &str, cwd: &str, timeout_ms: Option<u64>) -> AppResult<ScriptTickOutcome> {
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
        match child.try_wait() {
            Ok(Some(status)) => break status.code(),
            Ok(None) => {
                if Instant::now() >= deadline {
                    timed_out = true;
                    kill_process_group(&mut child);
                    let _ = child.wait();
                    break None;
                }
                std::thread::sleep(Duration::from_millis(POLL_MS));
            }
            Err(err) => {
                return Err(AppError::io(format!(
                    "could not wait for the script: {err}"
                )));
            }
        }
    };

    Ok(ScriptTickOutcome {
        code,
        stdout: stdout.join().unwrap_or_default(),
        stderr: stderr.join().unwrap_or_default(),
        timed_out,
    })
}

/// `sh -c` on Unix (its own process group, so the timeout kill reaches the
/// whole tree), `cmd /C` elsewhere.
fn shell_command(script: &str) -> Command {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        let mut command = Command::new("/bin/sh");
        command.arg("-c").arg(script).process_group(0);
        command
    }
    #[cfg(not(unix))]
    {
        let mut command = Command::new("cmd");
        command.arg("/C").arg(script);
        command
    }
}

/// Kill the script's whole process group (see module docs), then the child
/// itself as a fallback for platforms without process groups.
fn kill_process_group(child: &mut std::process::Child) {
    #[cfg(unix)]
    {
        // SAFETY: plain syscall on a pid we own; a stale pid is at worst a
        // no-op error return.
        let pgid = child.id() as i32;
        unsafe {
            libc::kill(-pgid, libc::SIGKILL);
        }
    }
    let _ = child.kill();
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
