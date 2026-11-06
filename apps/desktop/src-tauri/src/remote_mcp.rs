//! Remote access (Settings → Agents): the app runs the bundled CLI's
//! `kore mcp --http` server as a child, and drives the Tailscale CLI that
//! publishes it. Two capabilities and nothing more:
//!
//! - one long-lived `kore mcp --http` child per app, started against the open
//!   graph, stopped on request, on a restart, and when the app exits;
//! - a bounded run of `tailscale status` / `tailscale funnel` with its output.
//!
//! Which port, whether to publish, how to read Tailscale's answers, and where
//! the token lives are `@reflect/core` policy (`app/remote-access.ts`).

use std::io::Read;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::fs::{root_for_generation, GraphState};
use crate::process_tree;

/// Cap on the stderr kept from the server, and on each captured Tailscale
/// stream.
const OUTPUT_LIMIT: usize = 16 * 1024;
/// How long a fresh server gets to fail fast (bad port, short token) before
/// the start is reported as a success.
const STARTUP_GRACE: Duration = Duration::from_millis(400);
/// `tailscale funnel` waits for the tailnet admin to enable Funnel; the link
/// it prints first is the useful part, so a run is cut off after this.
const TAILSCALE_TIMEOUT: Duration = Duration::from_secs(15);
/// Unpublishing at quit is quick or not happening; don't hold the exit.
const EXIT_TAILSCALE_TIMEOUT: Duration = Duration::from_secs(3);
const POLL: Duration = Duration::from_millis(50);

/// The Tailscale subcommands the app may run.
const TAILSCALE_SUBCOMMANDS: [&str; 2] = ["status", "funnel"];

struct Running {
    child: Child,
    port: u16,
    graph_root: PathBuf,
    read_only: bool,
    stderr: Arc<Mutex<String>>,
}

/// The live server, if any, and every port a server ran on this session.
#[derive(Default)]
pub struct RemoteMcpState {
    running: Mutex<Option<Running>>,
    /// Ports that may be published on Funnel. Kept apart from `running`:
    /// a restart, a failed respawn or a server that died all empty that
    /// slot while the port can still be published.
    served_ports: Mutex<Vec<u16>>,
}

impl RemoteMcpState {
    fn lock(&self) -> std::sync::MutexGuard<'_, Option<Running>> {
        self.running
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
    }

    fn record_port(&self, port: u16) {
        let mut ports = self
            .served_ports
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        if !ports.contains(&port) {
            ports.push(port);
        }
    }

    fn take_ports(&self) -> Vec<u16> {
        std::mem::take(
            &mut *self
                .served_ports
                .lock()
                .unwrap_or_else(|poison| poison.into_inner()),
        )
    }

    /// Stop the server (a restart or the switch turned off; core unpublishes).
    pub fn stop(&self) {
        if let Some(mut running) = self.lock().take() {
            process_tree::terminate_tree(&mut running.child);
        }
    }

    /// App exit: stop the server and take every port it ran on off
    /// Tailscale Funnel. `funnel --bg` lives in the node's config, so without
    /// this the public URL would keep pointing at the port after Kore quits,
    /// ready to expose whatever binds it next.
    pub fn shutdown(&self) {
        self.stop();
        let ports = self.take_ports();
        if ports.is_empty() {
            return;
        }
        let Some(binary) = find_tailscale() else {
            return;
        };
        for port in ports {
            let off = vec![
                "funnel".to_owned(),
                "--bg".to_owned(),
                port.to_string(),
                "off".to_owned(),
            ];
            if let Err(err) = run_bounded(binary.clone(), off, EXIT_TAILSCALE_TIMEOUT) {
                tracing::warn!(?err, port, "could not unpublish remote access at shutdown");
            }
        }
    }
}

#[derive(Clone, Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteMcpStatus {
    pub running: bool,
    pub port: Option<u16>,
    pub graph_root: Option<String>,
    pub read_only: bool,
    /// What the server wrote to stderr when it exited on its own.
    pub exit_message: Option<String>,
}

fn stopped(exit_message: Option<String>) -> RemoteMcpStatus {
    RemoteMcpStatus {
        running: false,
        port: None,
        graph_root: None,
        read_only: false,
        exit_message,
    }
}

/// The current status; a server that exited on its own is reaped here and
/// reported with its last words.
fn status_of(slot: &mut Option<Running>) -> RemoteMcpStatus {
    let Some(running) = slot.as_mut() else {
        return stopped(None);
    };
    if let Ok(None) = running.child.try_wait() {
        return RemoteMcpStatus {
            running: true,
            port: Some(running.port),
            graph_root: Some(running.graph_root.to_string_lossy().into_owned()),
            read_only: running.read_only,
            exit_message: None,
        };
    }
    let message = running
        .stderr
        .lock()
        .map(|text| text.trim().to_owned())
        .unwrap_or_default();
    *slot = None;
    stopped(Some(if message.is_empty() {
        "the server stopped".to_owned()
    } else {
        message
    }))
}

/// Append a stream to a shared, capped buffer until it closes.
fn drain_into(mut stream: impl Read + Send + 'static, sink: Arc<Mutex<String>>) {
    std::thread::spawn(move || {
        let mut chunk = [0u8; 4096];
        while let Ok(read) = stream.read(&mut chunk) {
            if read == 0 {
                break;
            }
            if let Ok(mut text) = sink.lock() {
                if text.len() < OUTPUT_LIMIT {
                    text.push_str(&String::from_utf8_lossy(&chunk[..read]));
                }
            }
        }
    });
}

/// The `kore` argument list for one server.
fn server_args(
    graph_root: &std::path::Path,
    port: u16,
    read_only: bool,
    public_url: Option<&str>,
) -> Vec<String> {
    let mut args = vec![
        "--graph".to_owned(),
        graph_root.to_string_lossy().into_owned(),
        "mcp".to_owned(),
        "--http".to_owned(),
        format!("127.0.0.1:{port}"),
    ];
    if read_only {
        args.push("--read-only".to_owned());
    }
    if let Some(url) = public_url {
        args.push("--public-url".to_owned());
        args.push(url.to_owned());
    }
    args
}

/// Command: (re)start `kore mcp --http` on `127.0.0.1:<port>` for the open
/// graph, with `token` as its secret and `agents` (a JSON list of named
/// agents' keys, passed through untouched) as `KORE_MCP_AGENTS`. Any running
/// server is stopped first.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn remote_mcp_start(
    generation: u64,
    port: u16,
    token: String,
    agents: String,
    read_only: bool,
    public_url: Option<String>,
    graph: State<'_, GraphState>,
    state: State<'_, RemoteMcpState>,
) -> AppResult<RemoteMcpStatus> {
    let graph_root = root_for_generation(&graph, generation)?;
    state.stop();
    state.record_port(port);

    let mut command = Command::new(crate::skill::cli_path()?);
    command
        .args(server_args(
            &graph_root,
            port,
            read_only,
            public_url.as_deref(),
        ))
        .env("KORE_MCP_TOKEN", token)
        .env("KORE_MCP_AGENTS", agents)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    process_tree::own_process_group(&mut command);
    let mut child = command.spawn()?;
    let stderr = Arc::new(Mutex::new(String::new()));
    if let Some(stream) = child.stderr.take() {
        drain_into(stream, Arc::clone(&stderr));
    }

    *state.lock() = Some(Running {
        child,
        port,
        graph_root,
        read_only,
        stderr,
    });
    tauri::async_runtime::spawn_blocking(|| std::thread::sleep(STARTUP_GRACE))
        .await
        .map_err(|err| AppError::io(err.to_string()))?;
    let status = status_of(&mut state.lock());
    match &status.exit_message {
        Some(message) if !status.running => Err(AppError::io(message.clone())),
        _ => Ok(status),
    }
}

/// Command: stop the server (a no-op when none is running).
#[tauri::command]
pub async fn remote_mcp_stop(state: State<'_, RemoteMcpState>) -> AppResult<RemoteMcpStatus> {
    state.stop();
    Ok(stopped(None))
}

/// Command: whether the server is running, and why it stopped if it died.
#[tauri::command]
pub async fn remote_mcp_status(state: State<'_, RemoteMcpState>) -> AppResult<RemoteMcpStatus> {
    Ok(status_of(&mut state.lock()))
}

#[derive(Clone, Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TailscaleRun {
    /// `false` when no Tailscale CLI was found; the other fields are empty.
    pub found: bool,
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
}

/// Where the Tailscale CLI lives on a Mac: the app bundle's binary doubles as
/// the CLI (App Store and standalone builds), Homebrew installs `tailscale`.
/// GUI apps launch with a minimal PATH, so the usual spots are probed too.
fn tailscale_candidates(path_env: Option<&std::ffi::OsStr>) -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = path_env
        .map(|paths| {
            std::env::split_paths(paths)
                .map(|dir| dir.join("tailscale"))
                .collect()
        })
        .unwrap_or_default();
    candidates.extend(
        [
            "/opt/homebrew/bin/tailscale",
            "/usr/local/bin/tailscale",
            "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
        ]
        .map(PathBuf::from),
    );
    candidates
}

fn find_tailscale() -> Option<PathBuf> {
    tailscale_candidates(std::env::var_os("PATH").as_deref())
        .into_iter()
        .find(|path| path.is_file())
}

fn run_bounded(binary: PathBuf, args: Vec<String>, timeout: Duration) -> AppResult<TailscaleRun> {
    let mut command = Command::new(binary);
    command
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    process_tree::own_process_group(&mut command);
    let mut child = command.spawn()?;
    let stdout = Arc::new(Mutex::new(String::new()));
    let stderr = Arc::new(Mutex::new(String::new()));
    if let Some(stream) = child.stdout.take() {
        drain_into(stream, Arc::clone(&stdout));
    }
    if let Some(stream) = child.stderr.take() {
        drain_into(stream, Arc::clone(&stderr));
    }
    let deadline = Instant::now() + timeout;
    let (code, timed_out) = loop {
        if let Some(status) = child.try_wait()? {
            break (status.code(), false);
        }
        if Instant::now() >= deadline {
            process_tree::terminate_tree(&mut child);
            break (None, true);
        }
        std::thread::sleep(POLL);
    };
    // Let the drain threads catch the last bytes after the pipes close.
    std::thread::sleep(POLL);
    let read = |buffer: &Arc<Mutex<String>>| buffer.lock().map(|t| t.clone()).unwrap_or_default();
    Ok(TailscaleRun {
        found: true,
        code,
        stdout: read(&stdout),
        stderr: read(&stderr),
        timed_out,
    })
}

/// Command: run `tailscale <args>` (only `status` and `funnel`), bounded by a
/// timeout, and return what it printed.
#[tauri::command]
pub async fn tailscale_run(args: Vec<String>) -> AppResult<TailscaleRun> {
    let allowed = args
        .first()
        .is_some_and(|sub| TAILSCALE_SUBCOMMANDS.contains(&sub.as_str()));
    if !allowed {
        return Err(AppError::io(
            "only `tailscale status` and `tailscale funnel` can run",
        ));
    }
    let Some(binary) = find_tailscale() else {
        return Ok(TailscaleRun {
            found: false,
            code: None,
            stdout: String::new(),
            stderr: String::new(),
            timed_out: false,
        });
    };
    tauri::async_runtime::spawn_blocking(move || run_bounded(binary, args, TAILSCALE_TIMEOUT))
        .await
        .map_err(|err| AppError::io(err.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn served_ports_outlive_the_running_slot_until_shutdown_takes_them() {
        let state = RemoteMcpState::default();
        state.record_port(8765);
        state.record_port(8765);
        state.record_port(9000);
        // A restart or a dead server empties the slot, not the port list.
        state.stop();
        assert_eq!(state.take_ports(), [8765, 9000]);
        assert!(state.take_ports().is_empty());
    }

    #[test]
    fn server_args_pin_loopback_and_pass_the_options() {
        let args = server_args(Path::new("/v"), 8765, true, Some("https://m.ts.net"));
        assert_eq!(
            args,
            [
                "--graph",
                "/v",
                "mcp",
                "--http",
                "127.0.0.1:8765",
                "--read-only",
                "--public-url",
                "https://m.ts.net"
            ]
        );
        let plain = server_args(Path::new("/v"), 9000, false, None);
        assert_eq!(plain, ["--graph", "/v", "mcp", "--http", "127.0.0.1:9000"]);
    }

    #[test]
    fn tailscale_is_probed_on_path_then_the_usual_installs() {
        let candidates = tailscale_candidates(Some(std::ffi::OsStr::new("/a:/b")));
        assert_eq!(candidates[0], PathBuf::from("/a/tailscale"));
        assert_eq!(candidates[1], PathBuf::from("/b/tailscale"));
        assert!(candidates
            .iter()
            .any(|path| path.ends_with("Tailscale.app/Contents/MacOS/Tailscale")));
    }

    #[test]
    fn a_dead_server_is_reported_with_its_stderr() {
        let mut child = Command::new("sh")
            .args(["-c", "exit 2"])
            .spawn()
            .expect("spawn sh");
        child.wait().expect("wait");
        let mut slot = Some(Running {
            child,
            port: 1,
            graph_root: PathBuf::from("/v"),
            read_only: false,
            stderr: Arc::new(Mutex::new("kore: address in use\n".into())),
        });
        let status = status_of(&mut slot);
        assert!(!status.running);
        assert_eq!(status.exit_message.as_deref(), Some("kore: address in use"));
        assert!(slot.is_none());
        assert_eq!(status_of(&mut slot), stopped(None));
    }

    #[test]
    fn a_bounded_run_returns_its_exit_code_and_both_streams() {
        let done = run_bounded(
            PathBuf::from("sh"),
            vec!["-c".into(), "echo hi; echo err >&2".into()],
            TAILSCALE_TIMEOUT,
        )
        .expect("run");
        assert_eq!(done.code, Some(0));
        assert_eq!(done.stdout.trim(), "hi");
        assert_eq!(done.stderr.trim(), "err");
        assert!(!done.timed_out);
    }

    #[test]
    fn a_bounded_run_cuts_off_a_hang_and_keeps_what_it_printed() {
        let hung = run_bounded(
            PathBuf::from("sh"),
            vec!["-c".into(), "echo visit-this-link; sleep 30".into()],
            Duration::from_millis(300),
        )
        .expect("run");
        assert!(hung.timed_out);
        assert_eq!(hung.code, None);
        assert_eq!(hung.stdout.trim(), "visit-this-link");
    }
}
