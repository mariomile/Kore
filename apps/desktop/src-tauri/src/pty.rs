//! Desktop PTY for the in-app terminal.
//!
//! Ghostty's `libghostty` cannot run inside Tauri's webview. This module
//! owns a local shell PTY (`portable-pty`); the frontend renders it with
//! xterm.js in a Ghostty-inspired theme.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::error::{AppError, AppResult};
use crate::fs::{current_root, GraphState};
use crate::process_tree::{self, ReapableChild};

const DATA_EVENT: &str = "pty:data";
const EXIT_EVENT: &str = "pty:exit";
const OUTPUT_CHANNEL_CAPACITY: usize = 256;

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

struct PtySession {
    /// Input for the session's writer thread (see `spawn_writer`).
    input: mpsc::Sender<Vec<u8>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    child: Mutex<Box<dyn portable_pty::Child + Send + Sync>>,
    output_ack: Mutex<u64>,
    output_ready: Condvar,
}

#[derive(Default)]
pub struct PtyState {
    sessions: Mutex<HashMap<String, Arc<PtySession>>>,
}

/// The shell is a session leader (`portable_pty` calls `setsid`), so
/// terminating it through `process_tree` reaches every job the user started
/// from it — a `claude` run, its MCP servers, a stray dev server. Closing
/// only the shell would leave all of them running with no window left to
/// stop them from.
impl ReapableChild for Box<dyn portable_pty::Child + Send + Sync> {
    fn pid(&self) -> Option<u32> {
        self.process_id()
    }

    fn try_reap(&mut self) -> bool {
        matches!(self.try_wait(), Ok(Some(_)) | Err(_))
    }

    fn reap(&mut self) {
        let _ = self.wait();
    }
}

impl PtyState {
    /// Terminate every open terminal and everything running inside it.
    /// Called when the app exits — a quit that only drops the sessions would
    /// orphan whatever the user left running in them.
    pub fn close_all(&self) {
        let sessions: Vec<(String, Arc<PtySession>)> = match self.sessions.lock() {
            Ok(mut open) => open.drain().collect(),
            Err(poisoned) => poisoned.into_inner().drain().collect(),
        };
        for (id, session) in sessions {
            tracing::info!(id, "closing terminal session at shutdown");
            terminate_session(&session);
        }
    }
}

/// Release the emitter thread and take the session's whole tree down.
fn terminate_session(session: &PtySession) {
    let _ = acknowledge_output(session, u64::MAX);
    match session.child.lock() {
        Ok(mut child) => process_tree::terminate_tree(&mut *child),
        Err(poisoned) => process_tree::terminate_tree(&mut *poisoned.into_inner()),
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyDataPayload {
    id: String,
    data: String,
    sequence: u64,
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
        input: spawn_writer(writer),
        master: Mutex::new(pair.master),
        child: Mutex::new(child),
        output_ack: Mutex::new(0),
        output_ready: Condvar::new(),
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
    let (chunk_sender, chunk_receiver) = mpsc::sync_channel::<String>(OUTPUT_CHANNEL_CAPACITY);
    thread::spawn(move || {
        let mut buffer = [0_u8; 4096];
        let mut decoder = Utf8Stream::default();
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => {
                    let data = decoder.decode(&buffer[..count]);
                    if data.is_empty() {
                        continue;
                    }
                    if chunk_sender.send(data).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        let tail = decoder.finish();
        if !tail.is_empty() {
            let _ = chunk_sender.send(tail);
        }
        // Dropping the sender closes the channel — the emitter's exit signal.
    });

    let read_app = app.clone();
    let read_id = id.clone();
    thread::spawn(move || {
        const COALESCE_WINDOW: Duration = Duration::from_millis(12);
        const MAX_COALESCED_BYTES: usize = 256 * 1024;
        let mut sequence = 1_u64;
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
            if read_app
                .emit(
                    DATA_EVENT,
                    PtyDataPayload {
                        id: read_id.clone(),
                        data,
                        sequence,
                    },
                )
                .is_err()
            {
                break;
            }
            if let Ok(acknowledged) = session.output_ack.lock() {
                drop(
                    session
                        .output_ready
                        .wait_while(acknowledged, |latest| *latest < sequence),
                );
            }
            sequence = sequence.wrapping_add(1);
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

/// Feed a session's input from its own thread, in order.
///
/// A PTY write blocks once the kernel buffer (a few KB) is full and the
/// program inside is not reading, which is what a large paste into vim or a
/// running agent does. Writing from the command itself ran that wait on the
/// main thread and froze the whole app until the program caught up. The
/// queue keeps keystroke order, which concurrent async writes would not.
fn spawn_writer(mut writer: Box<dyn Write + Send>) -> mpsc::Sender<Vec<u8>> {
    let (sender, receiver) = mpsc::channel::<Vec<u8>>();
    thread::spawn(move || {
        for bytes in receiver {
            if let Err(err) = writer.write_all(&bytes).and_then(|()| writer.flush()) {
                tracing::warn!(%err, "pty write failed; dropping further input");
                break;
            }
        }
        // All senders dropped (the session is gone) or the PTY closed.
    });
    sender
}

/// Queue bytes for an open PTY. Returns at once; the session's writer thread
/// delivers them (see `spawn_writer`).
#[tauri::command]
pub fn pty_write(state: State<'_, PtyState>, id: String, data: String) -> AppResult<()> {
    let session = lookup(&state, &id)?;
    session
        .input
        .send(data.into_bytes())
        .map_err(|_| AppError::unknown(format!("pty session {id} no longer accepts input")))
}

fn acknowledge_output(session: &PtySession, sequence: u64) -> AppResult<()> {
    let mut acknowledged = session
        .output_ack
        .lock()
        .map_err(|_| AppError::unknown("pty output acknowledgment lock poisoned"))?;
    *acknowledged = (*acknowledged).max(sequence);
    session.output_ready.notify_all();
    Ok(())
}

/// Confirm that xterm has parsed one output event. Late acknowledgments for a
/// closed session are harmless.
#[tauri::command]
pub fn pty_ack(state: State<'_, PtyState>, id: String, sequence: u64) -> AppResult<()> {
    let session = state
        .sessions
        .lock()
        .map_err(|_| AppError::unknown("pty state lock poisoned"))?
        .get(&id)
        .cloned();
    match session {
        Some(session) => acknowledge_output(&session, sequence),
        None => Ok(()),
    }
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

/// Kill an open PTY and everything running inside it. Idempotent if the
/// session is already gone.
///
/// Async because the teardown is not instant: the shell's tree gets a grace
/// period between `SIGTERM` and `SIGKILL`, and the UI thread must not wait
/// it out.
#[tauri::command]
pub async fn pty_close(state: State<'_, PtyState>, id: String) -> AppResult<()> {
    let session = {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| AppError::unknown("pty state lock poisoned"))?;
        sessions.remove(&id)
    };
    let Some(session) = session else {
        return Ok(());
    };
    crate::blocking::run_blocking(move || {
        terminate_session(&session);
        Ok(())
    })
    .await
}

/// Decodes a byte stream that arrives in arbitrary chunks. A multi-byte
/// character (an accented letter, an emoji) that straddles two reads is held
/// back until its last byte arrives, instead of being decoded half at a time
/// into two U+FFFD replacement characters. Bytes that can never be valid
/// UTF-8 still become U+FFFD, as before.
#[derive(Default)]
struct Utf8Stream {
    pending: Vec<u8>,
}

impl Utf8Stream {
    fn decode(&mut self, bytes: &[u8]) -> String {
        self.pending.extend_from_slice(bytes);
        let mut out = String::with_capacity(self.pending.len());
        let mut start = 0;
        while start < self.pending.len() {
            match std::str::from_utf8(&self.pending[start..]) {
                Ok(valid) => {
                    out.push_str(valid);
                    start = self.pending.len();
                }
                Err(err) => {
                    let valid_end = start + err.valid_up_to();
                    // `valid_up_to` marks a prefix that is valid UTF-8.
                    out.push_str(
                        std::str::from_utf8(&self.pending[start..valid_end]).unwrap_or_default(),
                    );
                    match err.error_len() {
                        Some(invalid) => {
                            out.push(char::REPLACEMENT_CHARACTER);
                            start = valid_end + invalid;
                        }
                        // An incomplete sequence at the end: wait for more.
                        None => {
                            start = valid_end;
                            break;
                        }
                    }
                }
            }
        }
        self.pending.drain(..start);
        out
    }

    /// Whatever is still held back when the stream ends.
    fn finish(&mut self) -> String {
        let rest = String::from_utf8_lossy(&self.pending).into_owned();
        self.pending.clear();
        rest
    }
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

#[cfg(test)]
mod tests {
    use super::Utf8Stream;

    fn decode_in_chunks(bytes: &[u8], size: usize) -> String {
        let mut stream = Utf8Stream::default();
        let mut out: String = bytes
            .chunks(size)
            .map(|chunk| stream.decode(chunk))
            .collect();
        out.push_str(&stream.finish());
        out
    }

    #[test]
    fn a_character_split_across_reads_is_decoded_whole() {
        let text = "città → 🦀 perché";
        for size in 1..=text.len() {
            assert_eq!(
                decode_in_chunks(text.as_bytes(), size),
                text,
                "chunk size {size}"
            );
        }
    }

    #[test]
    fn invalid_bytes_still_become_replacement_characters() {
        let bytes = b"a\xffb\xc3(c";
        assert_eq!(decode_in_chunks(bytes, 1), "a\u{FFFD}b\u{FFFD}(c");
        assert_eq!(decode_in_chunks(bytes, bytes.len()), "a\u{FFFD}b\u{FFFD}(c");
    }

    #[test]
    fn a_truncated_character_at_the_end_of_the_stream_is_flushed() {
        let mut stream = Utf8Stream::default();
        assert_eq!(stream.decode(b"ok \xf0\x9f"), "ok ");
        assert_eq!(stream.finish(), "\u{FFFD}");
    }
}
