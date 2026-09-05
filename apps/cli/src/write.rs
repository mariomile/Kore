//! The CLI's file-write primitives, shared by every writing command. All
//! writes are atomic (a sibling temp file renamed into place) so a crash
//! mid-write can never leave a truncated note, and every write honours the
//! note's own line ending.

use std::fs;
use std::io::Write;
use std::path::Path;

use crate::error::CliError;

/// The note's own line ending, from its first line break (LF for new files).
pub fn line_ending(content: &str) -> &'static str {
    match content.find('\n') {
        Some(index) if index > 0 && content.as_bytes()[index - 1] == b'\r' => "\r\n",
        _ => "\n",
    }
}

/// Write through a sibling temp file + rename so a crash mid-write can never
/// leave a half-written note behind.
pub fn atomic_write(path: &Path, contents: &str) -> Result<(), CliError> {
    let dir = path
        .parent()
        .ok_or_else(|| CliError::Runtime(format!("no parent directory for {}", path.display())))?;
    fs::create_dir_all(dir)?;
    let mut tmp = tempfile::NamedTempFile::new_in(dir)?;
    tmp.write_all(contents.as_bytes())?;
    tmp.flush()?;
    tmp.persist(path)
        .map_err(|err| CliError::Runtime(err.to_string()))?;
    Ok(())
}

/// Read everything on stdin (the `--stdin` flags), trimmed of trailing
/// line breaks.
pub fn read_stdin() -> Result<String, CliError> {
    let text = std::io::read_to_string(std::io::stdin())
        .map_err(|err| CliError::Runtime(format!("could not read stdin: {err}")))?;
    Ok(text.trim_end_matches(['\n', '\r']).to_string())
}
