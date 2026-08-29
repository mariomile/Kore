use crate::error::AppResult;

/// No iCloud metadata queries off Apple platforms — honest no-ops so the
/// command surface never branches.
pub fn start(
    _app: tauri::AppHandle,
    _root: String,
    _emit_file_changes: bool,
    _authoritative: bool,
) -> AppResult<()> {
    Ok(())
}

pub fn stop(_app: tauri::AppHandle) -> AppResult<()> {
    Ok(())
}

/// No query, no view — "unknown", so scoped sweeps fall back to full.
pub(crate) fn conflicted_paths() -> Option<std::collections::HashSet<String>> {
    None
}
