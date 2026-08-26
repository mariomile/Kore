//! Mobile stand-in for the in-app terminal. A PTY is desktop-only; these
//! commands stay registered so the IPC surface matches, but every call fails
//! loudly. The mobile tree never mounts a terminal route.

use crate::error::{AppError, AppResult};

/// Unit stand-in so `lib.rs` manages the same type name on every platform.
#[derive(Default)]
pub struct PtyState;

fn desktop_only<T>() -> AppResult<T> {
    Err(AppError::unknown("the in-app terminal is desktop-only"))
}

#[tauri::command]
pub fn pty_open() -> AppResult<()> {
    desktop_only()
}

#[tauri::command]
pub fn pty_write() -> AppResult<()> {
    desktop_only()
}

#[tauri::command]
pub fn pty_ack() -> AppResult<()> {
    desktop_only()
}

#[tauri::command]
pub fn pty_resize() -> AppResult<()> {
    desktop_only()
}

#[tauri::command]
pub fn pty_close() -> AppResult<()> {
    desktop_only()
}
