//! Agent-CLI bridge (the "subscription" AI providers).
//!
//! Runs a locally installed coding-agent CLI — Claude Code (`claude`),
//! Codex (`codex`), or Cursor (`cursor-agent`) — in headless mode so AI
//! chat can bill the user's subscription instead of a BYOK API key. The
//! frontend engines (`@reflect/core`'s `ai/claude-cli`, `ai/codex-cli`, and
//! `ai/cursor-cli`) own the protocol: they build each binary's arguments
//! (including the sandbox/permission lockdown that keeps `private: true`
//! notes unreadable) and parse the emitted JSON lines. This module only
//! resolves the binary from a closed set, spawns it, streams stdout lines
//! as Tauri events, and kills the child on request — it never composes
//! arguments itself. The one file it writes is the run's declarative
//! permission config when an engine supplies one (Cursor reads its rules
//! from `.cursor/cli.json` in the workspace, not from a flag).

use std::collections::{HashMap, HashSet};
use std::ffi::{OsStr, OsString};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
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
    CursorAgent,
}

impl AgentCliBinary {
    fn file_name(self) -> &'static str {
        match (self, cfg!(windows)) {
            (Self::Claude, false) => "claude",
            (Self::Claude, true) => "claude.exe",
            (Self::Codex, false) => "codex",
            (Self::Codex, true) => "codex.exe",
            (Self::CursorAgent, false) => "cursor-agent",
            (Self::CursorAgent, true) => "cursor-agent.exe",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Claude => "Claude Code CLI (`claude`)",
            Self::Codex => "Codex CLI (`codex`)",
            Self::CursorAgent => "Cursor CLI (`cursor-agent`)",
        }
    }
}

/// A declarative permission config an engine asks to have materialized in
/// the run's working directory before the spawn — Cursor's `.cursor/cli.json`
/// is file-based, with no flag equivalent. The path is confined to the run's
/// `cwd`: relative, no parent traversal, and always a `.json` file.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceConfigFile {
    relative_path: String,
    contents: String,
}

/// Write the engine's permission config under `cwd`, refusing anything that
/// could reach outside it.
fn write_workspace_config(cwd: &str, config: &WorkspaceConfigFile) -> AppResult<()> {
    let relative = std::path::Path::new(&config.relative_path);
    let traversal = relative.components().any(|component| {
        !matches!(
            component,
            std::path::Component::Normal(_) | std::path::Component::CurDir
        )
    });
    if traversal || !config.relative_path.ends_with(".json") {
        return Err(AppError::traversal(
            "workspace config path must be a relative .json file",
        ));
    }
    let target = std::path::Path::new(cwd).join(relative);
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| AppError::io(format!("could not create {}: {err}", parent.display())))?;
    }
    std::fs::write(&target, &config.contents)
        .map_err(|err| AppError::io(format!("could not write {}: {err}", target.display())))
}

/// Live child processes by request id, so a stop request can kill mid-run.
#[derive(Default)]
pub struct AgentCliState(Mutex<HashMap<String, Child>>);

/// Held-open stdin pipes for streaming-input runs (`keep_stdin_open`), by
/// request id: `agent_cli_send` steers more input into a live turn, and
/// removing an entry (close command, run done, stop) drops the pipe — the
/// CLI sees end-of-input and finishes.
#[derive(Default)]
pub struct AgentCliStdinState(Mutex<HashMap<String, ChildStdin>>);

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
    resolve_binary_in(
        binary.file_name(),
        std::env::var_os("PATH").as_deref(),
        dirs_home().as_deref(),
    )
}

fn resolve_binary_in(name: &str, path_env: Option<&OsStr>, home: Option<&Path>) -> Option<PathBuf> {
    let mut probes = Vec::new();
    if let Some(path_env) = path_env {
        probes.extend(std::env::split_paths(path_env).map(|dir| dir.join(name)));
    }
    probes.extend(
        extra_bin_dirs_in(home)
            .into_iter()
            .map(|dir| dir.join(name)),
    );
    unique_dirs(probes).into_iter().find(|path| path.is_file())
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

/// Directories GUI apps typically miss because launchd starts them with
/// `/usr/bin:/bin:/usr/sbin:/sbin`. npm-installed CLIs (`codex`, `claude`)
/// are `#!/usr/bin/env node` wrappers, so the child needs these on PATH
/// even after we locate the wrapper by probing.
fn extra_bin_dirs_in(home: Option<&Path>) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = home {
        dirs.push(home.join(".local/bin"));
        dirs.push(home.join(".claude/local"));
        dirs.push(home.join(".volta/bin"));
        dirs.push(home.join(".asdf/shims"));
        dirs.push(home.join(".local/share/mise/shims"));
        dirs.push(home.join(".bun/bin"));
        dirs.push(home.join(".cargo/bin"));
        dirs.push(home.join(".npm-global/bin"));
        dirs.push(home.join("Library/pnpm"));
        push_nvm_bins(home, &mut dirs);
        push_fnm_bins(home, &mut dirs);
        #[cfg(windows)]
        {
            dirs.push(home.join("AppData/Roaming/npm"));
            dirs.push(home.join("AppData/Local/pnpm"));
        }
    }
    #[cfg(unix)]
    {
        dirs.push(PathBuf::from("/usr/local/bin"));
        dirs.push(PathBuf::from("/opt/homebrew/bin"));
        dirs.push(PathBuf::from("/opt/homebrew/sbin"));
    }
    #[cfg(windows)]
    {
        dirs.push(PathBuf::from(r"C:\Program Files\nodejs"));
    }
    dirs
}

fn push_nvm_bins(home: &Path, dirs: &mut Vec<PathBuf>) {
    let nvm_dir = home.join(".nvm");
    let versions_root = nvm_dir.join("versions/node");
    if let Ok(default) = std::fs::read_to_string(nvm_dir.join("alias/default")) {
        let name = default.trim();
        if !name.is_empty() {
            for candidate in [
                versions_root.join(name).join("bin"),
                versions_root.join(format!("v{name}")).join("bin"),
            ] {
                if candidate.is_dir() {
                    dirs.push(candidate);
                    break;
                }
            }
        }
    }
    let Ok(entries) = std::fs::read_dir(&versions_root) else {
        return;
    };
    for entry in entries.flatten() {
        let bin = entry.path().join("bin");
        if bin.is_dir() {
            dirs.push(bin);
        }
    }
}

fn push_fnm_bins(home: &Path, dirs: &mut Vec<PathBuf>) {
    let roots = [
        home.join(".local/share/fnm/node-versions"),
        home.join(".fnm/node-versions"),
        home.join("Library/Application Support/fnm/node-versions"),
    ];
    for root in roots {
        let Ok(entries) = std::fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            let bin = entry.path().join("installation/bin");
            if bin.is_dir() {
                dirs.push(bin);
            }
        }
    }
}

fn unique_dirs(dirs: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    dirs.into_iter()
        .filter(|dir| seen.insert(dir.clone()))
        .collect()
}

/// PATH for a spawned CLI: the wrapper's own directory first (where `node`
/// usually sits next to an npm global), then the GUI-missing extras, then
/// the process PATH.
fn gui_path_for(binary_path: &Path, path_env: Option<&OsStr>, home: Option<&Path>) -> OsString {
    let mut dirs = Vec::new();
    if let Some(parent) = binary_path.parent() {
        dirs.push(parent.to_path_buf());
    }
    dirs.extend(extra_bin_dirs_in(home));
    if let Some(path_env) = path_env {
        dirs.extend(std::env::split_paths(path_env));
    }
    let unique = unique_dirs(dirs);
    std::env::join_paths(&unique)
        .unwrap_or_else(|_| path_env.map_or_else(OsString::new, OsStr::to_os_string))
}

fn apply_gui_path(command: &mut Command, binary_path: &Path) {
    command.env(
        "PATH",
        gui_path_for(
            binary_path,
            std::env::var_os("PATH").as_deref(),
            dirs_home().as_deref(),
        ),
    );
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
        let mut command = Command::new(&path);
        apply_gui_path(&mut command, &path);
        let output = command
            .arg("--version")
            .stdin(Stdio::null())
            .output()
            .map_err(|err| AppError::io(format!("could not run {}: {err}", path.display())))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stderr = stderr.trim();
            return Err(AppError::io(if stderr.is_empty() {
                format!("{} --version failed", binary.label())
            } else {
                format!("{} --version failed: {stderr}", binary.label())
            }));
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
/// `cwd` scopes the run to the graph root. `stream_stderr` additionally
/// relays stderr lines as `Line` events — auth flows (`codex login`) talk on
/// stderr, and the frontend must see the OAuth URL they print there.
// Each parameter is one named field of the IPC payload; bundling them into
// a struct would change the wire shape for no reader benefit.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn agent_cli_run(
    app: tauri::AppHandle,
    state: tauri::State<'_, AgentCliState>,
    request_id: String,
    binary: AgentCliBinary,
    args: Vec<String>,
    prompt: String,
    cwd: Option<String>,
    stream_stderr: Option<bool>,
    env: Option<HashMap<String, String>>,
    workspace_config: Option<WorkspaceConfigFile>,
    keep_stdin_open: Option<bool>,
) -> AppResult<()> {
    let path = resolve_binary(binary)
        .ok_or_else(|| AppError::not_found(format!("{} was not found", binary.label())))?;

    if let Some(config) = workspace_config.as_ref() {
        let dir = cwd
            .as_deref()
            .ok_or_else(|| AppError::io("workspace config requires a working directory"))?;
        write_workspace_config(dir, config)?;
    }

    let mut command = Command::new(&path);
    command
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(dir) = cwd.as_deref() {
        command.current_dir(dir);
    }
    // Extra environment (MCP secrets): the child and the MCP servers it
    // spawns inherit these — the values never appear on any command line.
    if let Some(env) = env {
        command.envs(env);
    }
    // After MCP env so a secret named PATH cannot strip the GUI extras
    // `env node` needs to find Node next to npm-installed CLIs.
    apply_gui_path(&mut command, &path);

    let mut child = command
        .spawn()
        .map_err(|err| AppError::io(format!("could not start {}: {err}", path.display())))?;

    // Feed the prompt from its own thread and close stdin so the CLI starts
    // answering. A synchronous write here can deadlock: a long transcript
    // fills the stdin pipe while a child that already started emitting fills
    // stdout with no reader yet — both sides block forever. A failed write is
    // best-effort by design: the child then answers a truncated prompt or
    // exits, and the Done/Failed events below carry the outcome.
    let keep_open = keep_stdin_open.unwrap_or(false);
    if let Some(mut stdin) = child.stdin.take() {
        let stdin_app = app.clone();
        let stdin_id = request_id.clone();
        std::thread::spawn(move || {
            if keep_open {
                // Insert under the stdin mutex *before* writing so a
                // handshake reply (Codex `thread/start` → `turn/start`)
                // cannot race `agent_cli_send` and miss the pipe. Holding
                // the lock across the write also keeps later sends from
                // interleaving with a partial prompt.
                if let Some(state) = stdin_app.try_state::<AgentCliStdinState>() {
                    let mut pipes = state.0.lock().unwrap();
                    let _ = stdin.write_all(prompt.as_bytes());
                    let _ = stdin.flush();
                    pipes.insert(stdin_id, stdin);
                    return;
                }
            }
            let _ = stdin.write_all(prompt.as_bytes());
            // Otherwise dropping stdin closes the pipe — end-of-prompt.
        });
    }
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    // Drain stderr concurrently, keeping a bounded tail for the failure
    // message. Waiting for stdout EOF before reading stderr (the old order)
    // deadlocks a chatty child: once the ~64KB stderr pipe fills, the child
    // blocks mid-write and stops producing stdout, and nobody ever reads
    // either. The bound keeps a runaway logger from growing memory instead.
    // With `stream_stderr` the drain also relays each line as a `Line` event
    // (line-buffered rather than chunked, so the frontend sees whole lines).
    let stream_stderr = stream_stderr.unwrap_or(false);
    let stderr_app = app.clone();
    let stderr_id = request_id.clone();
    let stderr_tail = std::thread::spawn(move || {
        const TAIL_LIMIT: usize = 64 * 1024;
        if let Some(stderr) = stderr {
            if stream_stderr {
                let mut tail = String::new();
                for line in BufReader::new(stderr).lines() {
                    let Ok(line) = line else { break };
                    if !line.trim().is_empty() {
                        let _ = stderr_app.emit(
                            EVENT,
                            CliEvent::Line {
                                request_id: stderr_id.clone(),
                                line: line.clone(),
                            },
                        );
                    }
                    tail.push_str(&line);
                    tail.push('\n');
                    if tail.len() > TAIL_LIMIT {
                        let cut = tail.len() - TAIL_LIMIT;
                        tail.drain(..cut);
                    }
                }
                return tail;
            }
            let mut tail: Vec<u8> = Vec::new();
            let mut stderr = stderr;
            let mut chunk = [0_u8; 8192];
            loop {
                match stderr.read(&mut chunk) {
                    Ok(0) | Err(_) => break,
                    Ok(read) => {
                        tail.extend_from_slice(&chunk[..read]);
                        if tail.len() > TAIL_LIMIT {
                            tail.drain(..tail.len() - TAIL_LIMIT);
                        }
                    }
                }
            }
            return String::from_utf8_lossy(&tail).into_owned();
        }
        String::new()
    });

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
        // Collect the concurrently drained stderr tail for a useful failure
        // message (both CLIs print flag and auth errors there), then reap the
        // child. Stdout hit EOF, so the drain thread is done or about to be.
        let mut error_tail = String::new();
        if let Ok(buffer) = stderr_tail.join() {
            let tail: Vec<&str> = buffer.lines().rev().take(4).collect();
            error_tail = tail.into_iter().rev().collect::<Vec<_>>().join("\n");
        }
        // A streaming-input run's held stdin dies with the run.
        if let Some(stdin_state) = emit_app.try_state::<AgentCliStdinState>() {
            stdin_state.0.lock().unwrap().remove(&emit_id);
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
    stdin_state: tauri::State<'_, AgentCliStdinState>,
    request_id: String,
) -> AppResult<()> {
    stdin_state.0.lock().unwrap().remove(&request_id);
    let child = state.0.lock().unwrap().remove(&request_id);
    if let Some(mut child) = child {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

/// Write one line into a live streaming-input run's held-open stdin (mid-turn
/// steering). Fails with not-found when the run is gone or was started
/// without `keep_stdin_open` — the frontend then queues the message instead.
#[tauri::command]
pub async fn agent_cli_send(
    stdin_state: tauri::State<'_, AgentCliStdinState>,
    request_id: String,
    line: String,
) -> AppResult<()> {
    let mut pipes = stdin_state.0.lock().unwrap();
    let stdin = pipes
        .get_mut(&request_id)
        .ok_or_else(|| AppError::not_found("the run is no longer accepting input"))?;
    stdin
        .write_all(line.as_bytes())
        .and_then(|()| stdin.write_all(b"\n"))
        .and_then(|()| stdin.flush())
        .map_err(|err| AppError::io(format!("could not steer the run: {err}")))
}

/// Close a streaming-input run's held-open stdin: end-of-input, so the CLI
/// finishes its pending turns and exits. Unknown ids are a no-op — the run
/// may already have finished and cleaned up after itself.
#[tauri::command]
pub async fn agent_cli_stdin_close(
    stdin_state: tauri::State<'_, AgentCliStdinState>,
    request_id: String,
) -> AppResult<()> {
    stdin_state.0.lock().unwrap().remove(&request_id);
    Ok(())
}

#[cfg(test)]
mod workspace_config_tests {
    use super::*;

    fn config(path: &str) -> WorkspaceConfigFile {
        WorkspaceConfigFile {
            relative_path: path.to_string(),
            contents: "{}".to_string(),
        }
    }

    #[test]
    fn writes_a_relative_json_config_under_cwd() {
        let dir = std::env::temp_dir().join(format!("agent-cli-cfg-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let cwd = dir.to_str().unwrap();
        write_workspace_config(cwd, &config(".cursor/cli.json")).unwrap();
        let written = std::fs::read_to_string(dir.join(".cursor/cli.json")).unwrap();
        assert_eq!(written, "{}");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn refuses_traversal_absolute_paths_and_non_json() {
        for path in [
            "../evil.json",
            "/etc/evil.json",
            ".cursor/cli.txt",
            "a/../../b.json",
        ] {
            assert!(
                write_workspace_config("/tmp", &config(path)).is_err(),
                "{path}"
            );
        }
    }
}

#[cfg(test)]
mod path_tests {
    use super::*;
    use std::ffi::OsStr;

    fn split(path: &OsString) -> Vec<PathBuf> {
        std::env::split_paths(path).collect()
    }

    #[test]
    fn gui_path_puts_the_binary_dir_ahead_of_the_process_path() {
        let path = gui_path_for(
            Path::new("/opt/homebrew/bin/codex"),
            Some(OsStr::new("/usr/bin:/bin")),
            None,
        );
        let dirs = split(&path);
        assert_eq!(
            dirs.first().map(PathBuf::as_path),
            Some(Path::new("/opt/homebrew/bin"))
        );
        assert!(dirs.contains(&PathBuf::from("/usr/bin")));
        assert!(dirs.contains(&PathBuf::from("/bin")));
    }

    #[cfg(unix)]
    #[test]
    fn gui_path_includes_homebrew_and_usr_local() {
        let path = gui_path_for(Path::new("/tmp/codex"), Some(OsStr::new("/usr/bin")), None);
        let dirs = split(&path);
        assert!(dirs.contains(&PathBuf::from("/opt/homebrew/bin")));
        assert!(dirs.contains(&PathBuf::from("/usr/local/bin")));
    }

    #[test]
    fn resolve_binary_finds_nvm_installs_outside_path() {
        let home = tempfile::tempdir().unwrap();
        let bin = home.path().join(".nvm/versions/node/v22.14.0/bin");
        std::fs::create_dir_all(&bin).unwrap();
        let cli = bin.join("codex");
        std::fs::write(&cli, b"").unwrap();
        let found = resolve_binary_in("codex", None, Some(home.path()));
        assert_eq!(found.as_deref(), Some(cli.as_path()));
    }

    #[test]
    fn gui_path_includes_nvm_so_env_node_resolves() {
        let home = tempfile::tempdir().unwrap();
        let bin = home.path().join(".nvm/versions/node/v22.14.0/bin");
        std::fs::create_dir_all(&bin).unwrap();
        let path = gui_path_for(
            Path::new("/usr/local/bin/codex"),
            Some(OsStr::new("/usr/bin:/bin")),
            Some(home.path()),
        );
        let dirs = split(&path);
        assert!(dirs.contains(&bin), "nvm bin missing from PATH: {dirs:?}");
    }

    #[test]
    fn nvm_default_alias_is_searched_before_other_versions() {
        let home = tempfile::tempdir().unwrap();
        let default_bin = home.path().join(".nvm/versions/node/v20.11.0/bin");
        let other_bin = home.path().join(".nvm/versions/node/v18.0.0/bin");
        std::fs::create_dir_all(&default_bin).unwrap();
        std::fs::create_dir_all(&other_bin).unwrap();
        std::fs::create_dir_all(home.path().join(".nvm/alias")).unwrap();
        std::fs::write(home.path().join(".nvm/alias/default"), "20.11.0\n").unwrap();
        let extras = extra_bin_dirs_in(Some(home.path()));
        let default_pos = extras.iter().position(|dir| dir == &default_bin);
        let other_pos = extras.iter().position(|dir| dir == &other_bin);
        assert!(default_pos.is_some(), "default nvm bin missing: {extras:?}");
        assert!(other_pos.is_some(), "other nvm bin missing: {extras:?}");
        assert!(default_pos < other_pos);
    }
}
