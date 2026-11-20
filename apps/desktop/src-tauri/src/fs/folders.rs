//! Vault folder primitives: list, create, rename/move, trash, and reveal.
//!
//! Capability-only: every path is validated as a safe visible folder that can
//! hold notes (`kore_graph_paths::may_contain_notes`), traversal-guarded via
//! [`super::resolve`], and pinned to the issuing graph `generation`. Policy
//! (protected roots, session retargeting, index updates, link rewriting) lives
//! in TypeScript.

use std::fs;
use std::path::Path;

use tauri::Manager;

use crate::error::{AppError, AppResult};

#[cfg(mobile)]
use super::move_to_graph_trash;
#[cfg(desktop)]
use super::os_trash_delete;
use super::resolve::resolve;
use super::{
    current_graph_info, file_catalog, invalidate_file_catalog, reveal_asset_path,
    root_for_generation, GraphState,
};

fn ensure_visible_folder_path(path: &str) -> AppResult<()> {
    if kore_graph_paths::may_contain_notes(path) {
        return Ok(());
    }
    Err(AppError::traversal(format!("invalid folder path: {path}")))
}

fn create_folder_at(root: &Path, path: &str) -> AppResult<()> {
    ensure_visible_folder_path(path)?;
    let abs = resolve(root, path)?;
    if abs.exists() {
        return Err(AppError::io(format!(
            "cannot create folder: {path} already exists"
        )));
    }
    fs::create_dir_all(&abs)?;
    Ok(())
}

fn move_folder_at(root: &Path, from: &str, to: &str) -> AppResult<()> {
    ensure_visible_folder_path(from)?;
    ensure_visible_folder_path(to)?;
    if from == to {
        return Ok(());
    }
    let from_lower = from.to_ascii_lowercase();
    let to_lower = to.to_ascii_lowercase();
    if to_lower.starts_with(&format!("{from_lower}/")) {
        return Err(AppError::io(format!(
            "cannot move folder into itself: {from} -> {to}"
        )));
    }
    let from_abs = resolve(root, from)?;
    let to_abs = resolve(root, to)?;
    if !from_abs.is_dir() {
        return Err(AppError::not_found(format!("folder not found: {from}")));
    }
    // Allow case-only renames on case-insensitive filesystems (APFS).
    let case_only = from_lower == to_lower;
    if !case_only && to_abs.exists() {
        return Err(AppError::io(format!(
            "cannot move folder: {to} already exists"
        )));
    }
    if let Some(parent) = to_abs.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::rename(&from_abs, &to_abs)?;
    crate::conflict::shadow::ShadowStore::new(root).record_folder_move(from, to);
    Ok(())
}

/// List visible vault folders (from the same cached walk as [`super::list_files`]),
/// so empty subfolders created on disk appear in the Folders tree.
#[tauri::command]
pub async fn list_folders<R: tauri::Runtime>(
    generation: Option<u64>,
    app: tauri::AppHandle<R>,
) -> AppResult<Vec<String>> {
    let generation = match generation {
        Some(generation) => generation,
        None => {
            let state = app.state::<GraphState>();
            current_graph_info(&state)?.generation
        }
    };
    crate::blocking::run_blocking(move || {
        let state = app.state::<GraphState>();
        Ok(file_catalog(&state, Some(generation))?.dirs)
    })
    .await
}

/// Create a visible folder inside the vault, pinned to `generation`.
#[tauri::command]
pub async fn folder_create<R: tauri::Runtime>(
    path: String,
    generation: u64,
    app: tauri::AppHandle<R>,
) -> AppResult<()> {
    crate::blocking::run_blocking(move || {
        let state = app.state::<GraphState>();
        let root = root_for_generation(&state, generation)?;
        create_folder_at(&root, &path)?;
        invalidate_file_catalog(&state, &root);
        Ok(())
    })
    .await
}

/// Rename or move a visible folder inside the vault, pinned to `generation`.
#[tauri::command]
pub async fn folder_move<R: tauri::Runtime>(
    from: String,
    to: String,
    generation: u64,
    app: tauri::AppHandle<R>,
) -> AppResult<()> {
    crate::blocking::run_blocking(move || {
        let state = app.state::<GraphState>();
        let root = root_for_generation(&state, generation)?;
        move_folder_at(&root, &from, &to)?;
        invalidate_file_catalog(&state, &root);
        Ok(())
    })
    .await
}

/// Move a vault folder to the OS trash (recoverable on desktop; `.kore/trash/`
/// on mobile), pinned to `generation`.
#[tauri::command]
pub async fn folder_delete<R: tauri::Runtime>(
    path: String,
    generation: u64,
    app: tauri::AppHandle<R>,
) -> AppResult<()> {
    crate::blocking::run_blocking(move || {
        ensure_visible_folder_path(&path)?;
        let state = app.state::<GraphState>();
        let root = root_for_generation(&state, generation)?;
        let abs = resolve(&root, &path)?;
        if !abs.is_dir() {
            return Err(AppError::not_found(format!("folder not found: {path}")));
        }
        #[cfg(desktop)]
        os_trash_delete(&abs)?;
        #[cfg(mobile)]
        move_to_graph_trash(&root, &abs)?;
        crate::conflict::shadow::ShadowStore::new(&root).forget_folder(&path);
        invalidate_file_catalog(&state, &root);
        Ok(())
    })
    .await
}

/// Reveal a vault folder in Finder / the OS file manager, pinned to `generation`.
#[tauri::command]
pub async fn folder_reveal(path: String, generation: u64, app: tauri::AppHandle) -> AppResult<()> {
    ensure_visible_folder_path(&path)?;
    crate::blocking::run_blocking(move || {
        let state = app.state::<GraphState>();
        let root = root_for_generation(&state, generation)?;
        let abs = resolve(&root, &path)?;
        if !abs.is_dir() {
            return Err(AppError::not_found(format!("folder not found: {path}")));
        }
        reveal_asset_path(&app, &abs)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::{create_folder_at, move_folder_at};
    use std::fs;

    #[test]
    fn folder_create_and_move_enforce_safety_and_collisions() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();

        create_folder_at(root, "Active/Goals").unwrap();
        assert!(root.join("Active/Goals").is_dir());
        assert!(create_folder_at(root, "Active/Goals").is_err());
        assert!(create_folder_at(root, "../escape").is_err());
        assert!(create_folder_at(root, ".hidden").is_err());
        assert!(create_folder_at(root, "assets/sub").is_err());

        fs::write(root.join("Active/Goals/plan.md"), "# Plan\n").unwrap();
        assert!(move_folder_at(root, "Active/Goals", "Active/Goals/Nested").is_err());

        move_folder_at(root, "Active/Goals", "Archive/Goals").unwrap();
        assert!(!root.join("Active/Goals").exists());
        assert!(root.join("Archive/Goals/plan.md").is_file());

        create_folder_at(root, "Archive/Taken").unwrap();
        assert!(move_folder_at(root, "Archive/Goals", "Archive/Taken").is_err());
    }
}
