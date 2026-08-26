//! Desktop PTY for the in-app terminal.
//!
//! Ghostty's `libghostty` cannot run inside Tauri's webview. This module
//! owns a local shell PTY (`portable-pty`); the frontend renders it with
//! xterm.js in a Ghostty-inspired theme.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::error::{AppError, AppResult};
use crate::fs::{current_root, GraphState};

const DATA_EVENT: &str = "pty:data";
const EXIT_EVENT: &str = "pty:exit";
const OUTPUT_CHANNEL_CAPACITY: usize = 256;

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

struct PtySession {
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    child: Mutex<Box<dyn portable_pty::Child + Send + Sync>>,
}

#[derive(Default)]
pub struct PtyState {
    sessions: Mutex<HashMap<String, Arc<PtySession>>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyDataPayload {
    id: String,
    data: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyExitPayload {
    id: String,
    code: Option<i32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyOpenResult {
    pub id: String,
}

fn default_shell() -> String {
    if let Ok(shell) = std::env::var("SHELL") {
        if !shell.is_empty() {
            return shell;
        }
    }
    #[cfg(windows)]
    {
        std::env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".into())
    }
    #[cfg(target_os = "macos")]
    {
        "/bin/zsh".into()
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        "/bin/bash".into()
    }
}

fn pty_size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.max(1),
        cols: cols.max(1),
        pixel_width: 0,
        pixel_height: 0,
    }
}

/// Spawn a login shell in the open graph root.
#[tauri::command]
pub fn pty_open(
    app: AppHandle,
    graph: State<'_, GraphState>,
    state: State<'_, PtyState>,
    cols: u16,
    rows: u16,
) -> AppResult<PtyOpenResult> {
    let cwd = current_root(&graph)?;
    let system = native_pty_system();
    let pair = system
        .openpty(pty_size(cols, rows))
        .map_err(|err| AppError::unknown(format!("could not open pty: {err}")))?;

    let mut command = CommandBuilder::new(default_shell());
    command.cwd(&cwd);
    #[cfg(unix)]
    {
        command.arg("-l");
    }

    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|err| AppError::unknown(format!("could not spawn shell: {err}")))?;
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|err| AppError::unknown(format!("could not read pty: {err}")))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|err| AppError::unknown(format!("could not write pty: {err}")))?;

    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed).to_string();
    let session = Arc::new(PtySession {
        writer: Mutex::new(writer),
        master: Mutex::new(pair.master),
        child: Mutex::new(child),
    });

    {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| AppError::unknown("pty state lock poisoned"))?;
        sessions.insert(id.clone(), Arc::clone(&session));
    }

    // Backpressure is intentional: a noisy child may otherwise outrun the
    // webview and retain every unread chunk in process memory.
    let (chunk_sender, chunk_receiver) =
        mpsc::sync_channel::<String>(OUTPUT_CHANNEL_CAPACITY);
    thread::spawn(move || {
        let mut buffer = [0_u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => {
                    let data = String::from_utf8_lossy(&buffer[..count]).into_owned();
                    if chunk_sender.send(data).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        // Dropping the sender closes the channel — the emitter's exit signal.
    });

    let read_app = app.clone();
    let read_id = id.clone();
    thread::spawn(move || {
        const COALESCE_WINDOW: Duration = Duration::from_millis(12);
        const MAX_COALESCED_BYTES: usize = 256 * 1024;
        while let Ok(first) = chunk_receiver.recv() {
            let mut data = first;
            let deadline = Instant::now() + COALESCE_WINDOW;
            while data.len() < MAX_COALESCED_BYTES {
                let now = Instant::now();
                if now >= deadline {
                    break;
                }
                match chunk_receiver.recv_timeout(deadline - now) {
                    Ok(chunk) => data.push_str(&chunk),
                    Err(_) => break,
                }
            }
            let _ = read_app.emit(
                DATA_EVENT,
                PtyDataPayload {
                    id: read_id.clone(),
                    data,
                },
            );
        }
        let code = session
            .child
            .lock()
            .ok()
            .and_then(|mut child| child.try_wait().ok().flatten())
            .map(|status| status.exit_code() as i32);
        let _ = read_app.emit(
            EXIT_EVENT,
            PtyExitPayload {
                id: read_id.clone(),
                code,
            },
        );
        if let Ok(mut sessions) = read_app.state::<PtyState>().sessions.lock() {
            sessions.remove(&read_id);
        }
    });

    Ok(PtyOpenResult { id })
}

/// Write bytes into an open PTY.
#[tauri::command]
pub fn pty_write(state: State<'_, PtyState>, id: String, data: String) -> AppResult<()> {
    let session = lookup(&state, &id)?;
    let mut writer = session
        .writer
        .lock()
        .map_err(|_| AppError::unknown("pty writer lock poisoned"))?;
    writer
        .write_all(data.as_bytes())
        .map_err(|err| AppError::unknown(format!("pty write failed: {err}")))?;
    writer
        .flush()
        .map_err(|err| AppError::unknown(format!("pty flush failed: {err}")))?;
    Ok(())
}

/// Resize an open PTY to match the terminal viewport.
#[tauri::command]
pub fn pty_resize(state: State<'_, PtyState>, id: String, cols: u16, rows: u16) -> AppResult<()> {
    let session = lookup(&state, &id)?;
    let master = session
        .master
        .lock()
        .map_err(|_| AppError::unknown("pty master lock poisoned"))?;
    master
        .resize(pty_size(cols, rows))
        .map_err(|err| AppError::unknown(format!("pty resize failed: {err}")))?;
    Ok(())
}

/// Kill an open PTY. Idempotent if the session is already gone.
#[tauri::command]
pub fn pty_close(state: State<'_, PtyState>, id: String) -> AppResult<()> {
    let session = {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| AppError::unknown("pty state lock poisoned"))?;
        sessions.remove(&id)
    };
    if let Some(session) = session {
        if let Ok(mut child) = session.child.lock() {
            let _ = child.kill();
        }
    }
    Ok(())
}

fn lookup(state: &State<'_, PtyState>, id: &str) -> AppResult<Arc<PtySession>> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| AppError::unknown("pty state lock poisoned"))?;
    sessions
        .get(id)
        .cloned()
        .ok_or_else(|| AppError::unknown(format!("pty session {id} is gone")))
}
