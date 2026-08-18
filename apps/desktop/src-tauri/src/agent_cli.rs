//! Agent-CLI bridge (the "subscription" AI providers).
//!
//! Runs a locally installed coding-agent CLI — Claude Code (`claude`) or
//! Codex (`codex`) — in headless mode so AI chat can bill the user's Claude
//! or ChatGPT subscription instead of a BYOK API key. The frontend engines
//! (`@reflect/core`'s `ai/claude-cli` and `ai/codex-cli`) own the protocol:
//! they build each binary's arguments (including the sandbox/permission
//! lockdown that keeps `private: true` notes unreadable) and parse the
//! emitted JSON lines. This module only resolves the binary from a closed
//! set, spawns it, streams stdout lines as Tauri events, and kills the child
//! on request — it never composes arguments itself.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

use crate::error::{AppError, AppResult};

/// Event channel the frontend subscribes to; every payload carries the
/// request id so concurrent runs (or a stale listener) can't cross wires.
const EVENT: &str = "agent-cli:event";

/// The closed set of binaries this bridge will run — a frontend compromise
/// must not be able to escalate into running arbitrary programs.
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentCliBinary {
    Claude,
    Codex,
}

impl AgentCliBinary {
    fn file_name(self) -> &'static str {
        match (self, cfg!(windows)) {
            (Self::Claude, false) => "claude",
            (Self::Claude, true) => "claude.exe",
            (Self::Codex, false) => "codex",
            (Self::Codex, true) => "codex.exe",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Claude => "Claude Code CLI (`claude`)",
            Self::Codex => "Codex CLI (`codex`)",
        }
    }
}

/// Live child processes by request id, so a stop request can kill mid-run.
#[derive(Default)]
pub struct AgentCliState(Mutex<HashMap<String, Child>>);

#[derive(Clone, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum CliEvent {
    /// One stdout line (a stream-JSON event, passed through verbatim).
    Line { request_id: String, line: String },
    /// The process exited; `code` is the exit status when known.
    Done {
        request_id: String,
        code: Option<i32>,
    },
    /// Spawn or IO failure outside the JSON protocol.
    Failed { request_id: String, message: String },
}

/// Locate the binary. GUI apps on macOS launch with a minimal PATH, so the
/// common install locations are probed explicitly after `$PATH`.
fn resolve_binary(binary: AgentCliBinary) -> Option<PathBuf> {
    let name = binary.file_name();
    let candidates = std::env::var_os("PATH").map(|paths| {
        std::env::split_paths(&paths)
            .map(|dir| dir.join(name))
            .collect::<Vec<_>>()
    });
    let mut probes = candidates.unwrap_or_default();
    if let Some(home) = dirs_home() {
        probes.push(home.join(".local/bin").join(name));
        probes.push(home.join(".claude/local").join(name));
    }
    probes.push(PathBuf::from("/usr/local/bin").join(name));
    probes.push(PathBuf::from("/opt/homebrew/bin").join(name));
    probes.into_iter().find(|path| path.is_file())
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

/// Report whether the CLI is installed, and its version.
///
/// Used by the settings dialog as these providers' "key validation": there
/// is no API key — a resolvable, runnable binary is the whole requirement.
#[tauri::command]
pub async fn agent_cli_check(binary: AgentCliBinary) -> AppResult<String> {
    crate::blocking::run_blocking(move || {
        let path = resolve_binary(binary)
            .ok_or_else(|| AppError::not_found(format!("{} was not found", binary.label())))?;
        let output = Command::new(&path)
            .arg("--version")
            .stdin(Stdio::null())
            .output()
            .map_err(|err| AppError::io(format!("could not run {}: {err}", path.display())))?;
        if !output.status.success() {
            return Err(AppError::io(format!("{} --version failed", binary.label())));
        }
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    })
    .await
}

/// Start one headless run. Returns once the process is spawned; output
/// arrives as `agent-cli:event` payloads tagged with `request_id`.
///
/// `args` is the complete argument list (the frontend engine owns each
/// binary's flag protocol); `prompt` goes to stdin (arbitrary length) and
/// `cwd` scopes the run to the graph root.
#[tauri::command]
pub async fn agent_cli_run(
    app: tauri::AppHandle,
    state: tauri::State<'_, AgentCliState>,
    request_id: String,
    binary: AgentCliBinary,
    args: Vec<String>,
    prompt: String,
    cwd: Option<String>,
) -> AppResult<()> {
    let path = resolve_binary(binary)
        .ok_or_else(|| AppError::not_found(format!("{} was not found", binary.label())))?;

    let mut command = Command::new(&path);
    command
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(dir) = cwd.as_deref() {
        command.current_dir(dir);
    }

    let mut child = command
        .spawn()
        .map_err(|err| AppError::io(format!("could not start {}: {err}", path.display())))?;

    // Feed the prompt and close stdin so the CLI starts answering.
    if let Some(mut stdin) = child.stdin.take() {
        if let Err(err) = stdin.write_all(prompt.as_bytes()) {
            let _ = child.kill();
            return Err(AppError::io(format!("could not write the prompt: {err}")));
        }
    }
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    state.0.lock().unwrap().insert(request_id.clone(), child);

    // Stream stdout lines on a plain thread — the read loop is IO-bound and
    // must outlive this command's return.
    let emit_app = app.clone();
    let emit_id = request_id.clone();
    std::thread::spawn(move || {
        if let Some(stdout) = stdout {
            for line in BufReader::new(stdout).lines() {
                match line {
                    Ok(line) => {
                        if line.trim().is_empty() {
                            continue;
                        }
                        let _ = emit_app.emit(
                            EVENT,
                            CliEvent::Line {
                                request_id: emit_id.clone(),
                                line,
                            },
                        );
                    }
                    Err(_) => break,
                }
            }
        }
        // Drain stderr for a useful failure message (both CLIs print flag and
        // auth errors there), then reap the child.
        let mut error_tail = String::new();
        if let Some(mut stderr) = stderr {
            let mut buffer = String::new();
            if stderr.read_to_string(&mut buffer).is_ok() {
                let tail: Vec<&str> = buffer.lines().rev().take(4).collect();
                error_tail = tail.into_iter().rev().collect::<Vec<_>>().join("\n");
            }
        }
        let child = emit_app
            .try_state::<AgentCliState>()
            .and_then(|state| state.0.lock().unwrap().remove(&emit_id));
        let code = child
            .and_then(|mut child| child.wait().ok())
            .and_then(|status| status.code());
        if code.is_some_and(|code| code != 0) && !error_tail.is_empty() {
            let _ = emit_app.emit(
                EVENT,
                CliEvent::Failed {
                    request_id: emit_id.clone(),
                    message: error_tail,
                },
            );
        }
        let _ = emit_app.emit(
            EVENT,
            CliEvent::Done {
                request_id: emit_id,
                code,
            },
        );
    });

    Ok(())
}

/// Kill a running chat (the UI's stop button). Unknown ids are a no-op — the
/// run may already have finished.
#[tauri::command]
pub async fn agent_cli_stop(
    state: tauri::State<'_, AgentCliState>,
    request_id: String,
) -> AppResult<()> {
    let child = state.0.lock().unwrap().remove(&request_id);
    if let Some(mut child) = child {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}
