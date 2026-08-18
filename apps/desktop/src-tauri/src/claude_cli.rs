//! Claude Code CLI bridge (the "subscription" AI provider).
//!
//! Runs the locally installed `claude` binary in headless mode
//! (`-p --output-format stream-json`) so AI chat can bill the user's Claude
//! subscription instead of a BYOK API key. The frontend engine
//! (`@reflect/core`'s `ai/claude-cli`) owns the protocol: it builds the
//! prompt and the permission settings, and parses the emitted JSON lines.
//! This module only resolves the binary, spawns it, streams stdout lines as
//! Tauri events, and kills the child on request.
//!
//! Tool access is locked down at spawn time: only the tools the frontend
//! names are available (read-only graph access), everything else is outside
//! the built-in set, and per-file deny rules (the frontend passes one per
//! `private: true` note) are enforced by the CLI's own permission layer —
//! the hard privacy block holds even though the CLI reads files itself.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{Emitter, Manager};

use crate::error::{AppError, AppResult};

/// Event channel the frontend subscribes to; every payload carries the
/// request id so concurrent runs (or a stale listener) can't cross wires.
const EVENT: &str = "claude-cli:event";

/// Live child processes by request id, so a stop request can kill mid-run.
#[derive(Default)]
pub struct ClaudeCliState(Mutex<HashMap<String, Child>>);

#[derive(Clone, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum CliEvent {
    /// One stdout line (a stream-json event, passed through verbatim).
    Line { request_id: String, line: String },
    /// The process exited; `code` is the exit status when known.
    Done {
        request_id: String,
        code: Option<i32>,
    },
    /// Spawn or IO failure outside the JSON protocol.
    Failed { request_id: String, message: String },
}

/// Locate the `claude` binary. GUI apps on macOS launch with a minimal PATH,
/// so the common install locations are probed explicitly after `$PATH`.
fn resolve_claude_binary() -> Option<PathBuf> {
    let candidates = std::env::var_os("PATH").map(|paths| {
        std::env::split_paths(&paths)
            .map(|dir| dir.join(claude_binary_name()))
            .collect::<Vec<_>>()
    });
    let mut probes = candidates.unwrap_or_default();
    if let Some(home) = dirs_home() {
        probes.push(home.join(".local/bin").join(claude_binary_name()));
        probes.push(home.join(".claude/local").join(claude_binary_name()));
    }
    probes.push(PathBuf::from("/usr/local/bin").join(claude_binary_name()));
    probes.push(PathBuf::from("/opt/homebrew/bin").join(claude_binary_name()));
    probes.into_iter().find(|path| path.is_file())
}

fn claude_binary_name() -> &'static str {
    if cfg!(windows) {
        "claude.exe"
    } else {
        "claude"
    }
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

/// Report whether the Claude Code CLI is installed, and its version.
///
/// Used by the settings dialog as this provider's "key validation": there is
/// no API key — a resolvable, runnable binary is the whole requirement.
#[tauri::command]
pub async fn claude_cli_check() -> AppResult<String> {
    crate::blocking::run_blocking(|| {
        let binary = resolve_claude_binary()
            .ok_or_else(|| AppError::not_found("The Claude Code CLI (`claude`) was not found"))?;
        let output = Command::new(&binary)
            .arg("--version")
            .stdin(Stdio::null())
            .output()
            .map_err(|err| AppError::io(format!("could not run {}: {err}", binary.display())))?;
        if !output.status.success() {
            return Err(AppError::io("`claude --version` failed"));
        }
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    })
    .await
}

/// Start one headless chat run. Returns once the process is spawned; output
/// arrives as `claude-cli:event` payloads tagged with `request_id`.
///
/// `prompt` goes to stdin (arbitrary length), `system_prompt` via
/// `--append-system-prompt`. `tools` is the complete built-in tool set made
/// available (`--tools`, empty = none), `settings_json` carries the deny
/// rules, and `cwd` scopes relative tool paths to the graph root.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn claude_cli_run(
    app: tauri::AppHandle,
    state: tauri::State<'_, ClaudeCliState>,
    request_id: String,
    prompt: String,
    system_prompt: String,
    model: Option<String>,
    tools: Vec<String>,
    settings_json: Option<String>,
    cwd: Option<String>,
    max_turns: u32,
) -> AppResult<()> {
    let binary = resolve_claude_binary()
        .ok_or_else(|| AppError::not_found("The Claude Code CLI (`claude`) was not found"))?;

    let mut command = Command::new(&binary);
    command
        .arg("-p")
        .arg("--output-format")
        .arg("stream-json")
        .arg("--verbose")
        .arg("--include-partial-messages")
        .arg("--max-turns")
        .arg(max_turns.to_string())
        .arg("--tools")
        .arg(tools.join(","))
        .arg("--append-system-prompt")
        .arg(&system_prompt)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(model) = model.as_deref() {
        if !model.is_empty() {
            command.arg("--model").arg(model);
        }
    }
    if let Some(settings) = settings_json.as_deref() {
        command.arg("--settings").arg(settings);
    }
    if let Some(dir) = cwd.as_deref() {
        command.current_dir(dir);
    }

    let mut child = command
        .spawn()
        .map_err(|err| AppError::io(format!("could not start {}: {err}", binary.display())))?;

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
        // Drain stderr for a useful failure message (the CLI prints flag and
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
            .try_state::<ClaudeCliState>()
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
pub async fn claude_cli_stop(
    state: tauri::State<'_, ClaudeCliState>,
    request_id: String,
) -> AppResult<()> {
    let child = state.0.lock().unwrap().remove(&request_id);
    if let Some(mut child) = child {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}
