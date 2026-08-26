//! Mobile stand-in for the embedded in-app browser. Child webviews are a
//! desktop capability; these commands stay registered so the IPC surface
//! matches, but every call fails loudly. The mobile tree never mounts the
//! browser surface.

use crate::error::{AppError, AppResult};

#[derive(Default)]
pub struct BrowserState;

fn desktop_only<T>() -> AppResult<T> {
    Err(AppError::unknown("the embedded browser is desktop-only"))
}

#[tauri::command]
pub fn browser_embed_show() -> AppResult<()> {
    desktop_only()
}

#[tauri::command]
pub fn browser_embed_bounds() -> AppResult<()> {
    desktop_only()
}

#[tauri::command]
pub fn browser_embed_close() -> AppResult<()> {
    desktop_only()
}

#[tauri::command]
pub fn browser_embed_navigate() -> AppResult<()> {
    desktop_only()
}

#[tauri::command]
pub fn browser_embed_back() -> AppResult<()> {
    desktop_only()
}

#[tauri::command]
pub fn browser_embed_forward() -> AppResult<()> {
    desktop_only()
}

#[tauri::command]
pub fn browser_embed_reload() -> AppResult<()> {
    desktop_only()
}

#[tauri::command]
pub fn browser_embed_load() -> AppResult<()> {
    desktop_only()
}

#[tauri::command]
pub fn browser_embed_read() -> AppResult<()> {
    desktop_only()
}
