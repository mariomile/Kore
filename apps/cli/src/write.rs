//! The CLI's file-write primitives, shared by every writing command. All
//! writes are atomic (a synced temp file renamed into place) so a crash
//! mid-write can never leave a truncated note, and every write honours the
//! note's own line ending.

use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use reflect_index_schema::KORE_DIR;

use crate::agent_identity::AgentIdentity;
use crate::error::CliError;
use crate::note_file::checked_note_path;

/// The note's own line ending, from its first line break (LF for new files).
pub fn line_ending(content: &str) -> &'static str {
    match content.find('\n') {
        Some(index) if index > 0 && content.as_bytes()[index - 1] == b'\r' => "\r\n",
        _ => "\n",
    }
}

/// Write through a temp file + rename so a crash mid-write can never leave a
/// half-written note behind (see [`persist_synced`]).
pub fn atomic_write(path: &Path, contents: &str) -> Result<(), CliError> {
    let dir = path
        .parent()
        .ok_or_else(|| CliError::Runtime(format!("no parent directory for {}", path.display())))?;
    fs::create_dir_all(dir)?;
    persist_synced(dir, path, contents, false).map_err(|err| CliError::Runtime(err.to_string()))?;
    record_agent_write(path);
    Ok(())
}

/// Stage `contents` in a temp file, fsync it, then rename it onto `path`
/// (refusing to replace an existing file when `noclobber`).
///
/// The fsync comes before the rename: without it, a system crash or power
/// loss shortly after can leave the renamed note empty, because the rename
/// reached the disk before the data did. The temp is staged in the graph's
/// `.kore/tmp/` when there is one, as the desktop app does, so a temp
/// stranded by a crash never sits in a folder iCloud or git syncs. If that
/// is on another volume (a mount inside the vault) the rename cannot cross
/// it, and the write falls back to a sibling temp.
fn persist_synced(dir: &Path, path: &Path, contents: &str, noclobber: bool) -> std::io::Result<()> {
    let persist = |tmp: tempfile::NamedTempFile| {
        let persisted = if noclobber {
            tmp.persist_noclobber(path)
        } else {
            tmp.persist(path)
        };
        persisted.map(drop).map_err(|err| err.error)
    };
    match persist(stage_in(&staging_dir(dir), contents)?) {
        Err(err) if err.kind() == std::io::ErrorKind::CrossesDevices => {
            persist(stage_in(dir, contents)?)
        }
        other => other,
    }
}

fn stage_in(dir: &Path, contents: &str) -> std::io::Result<tempfile::NamedTempFile> {
    fs::create_dir_all(dir)?;
    let mut tmp = tempfile::NamedTempFile::new_in(dir)?;
    tmp.write_all(contents.as_bytes())?;
    tmp.as_file().sync_all()?;
    Ok(tmp)
}

/// `.kore/tmp/` of the nearest graph at or above `dir`, or `dir` itself when
/// it is not inside a graph.
fn staging_dir(dir: &Path) -> PathBuf {
    dir.ancestors()
        .map(|ancestor| ancestor.join(KORE_DIR))
        .find(|kore| kore.is_dir())
        .map_or_else(|| dir.to_path_buf(), |kore| kore.join("tmp"))
}

/// Why [`atomic_create`] did not create the file.
#[derive(Debug)]
pub enum CreateError {
    /// Something already sits at the path; it was left untouched.
    Exists,
    Other(std::io::Error),
}

/// Like [`atomic_write`], but never replaces a file that is already there:
/// the rename is a no-clobber link, so a concurrent creator always wins.
pub fn atomic_create(path: &Path, contents: &str) -> Result<(), CreateError> {
    let dir = path.parent().ok_or_else(|| {
        CreateError::Other(std::io::Error::other(format!(
            "no parent directory for {}",
            path.display()
        )))
    })?;
    fs::create_dir_all(dir).map_err(CreateError::Other)?;
    persist_synced(dir, path, contents, true).map_err(|err| {
        if err.kind() == std::io::ErrorKind::AlreadyExists {
            CreateError::Exists
        } else {
            CreateError::Other(err)
        }
    })?;
    record_agent_write(path);
    Ok(())
}

/// Set by `kore mcp` on the child that runs a tool call: the name of the
/// agent the write is made for.
pub const AGENT_ENV: &str = "KORE_AGENT";

/// Set alongside [`AGENT_ENV`]: the agent's commit address.
pub const AGENT_EMAIL_ENV: &str = "KORE_AGENT_EMAIL";

/// Set alongside [`AGENT_ENV`]: the graph root the journal lives in.
pub const AGENT_GRAPH_ENV: &str = "KORE_AGENT_GRAPH";

/// The graph-relative journal of notes agents wrote, which the app reads to
/// commit each agent's writes under its own name.
pub const AGENT_JOURNAL: &str = ".kore/agent-writes.jsonl";

/// Append `path` to the agent journal when this process runs a tool call
/// for an agent. Best effort: the note is already written, and a missing
/// journal line only means the write is attributed to the owner.
fn record_agent_write(path: &Path) {
    let Some(AgentIdentity { name: agent, email }) = current_agent() else {
        return;
    };
    let Some((root, rel_path)) = graph_relative(path) else {
        return;
    };
    let at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or_default();
    let line = serde_json::json!({ "at": at, "agent": agent, "email": email, "path": rel_path });
    let journal = root.join(AGENT_JOURNAL);
    let appended = journal
        .parent()
        .map_or(Ok(()), fs::create_dir_all)
        .and_then(|()| {
            fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&journal)
        })
        .and_then(|mut file| writeln!(file, "{line}"));
    if let Err(err) = appended {
        eprintln!("kore: could not record the agent write in {AGENT_JOURNAL}: {err}");
    }
}

/// The agent this process runs a tool call for, when `kore mcp` started it
/// as one. Both values come from one [`AgentIdentity`], so the address is
/// rebuilt from the name rather than trusted.
pub fn current_agent() -> Option<AgentIdentity> {
    std::env::var(AGENT_EMAIL_ENV).ok()?;
    let name = std::env::var(AGENT_ENV).ok()?;
    Some(AgentIdentity::for_caller(Some(&name)))
}

/// The graph the tool call runs against (`AGENT_GRAPH_ENV`) and `path`
/// relative to it with `/` separators. `None` for anything inside
/// `.kore/` itself or outside that graph.
fn graph_relative(path: &Path) -> Option<(PathBuf, String)> {
    let root = PathBuf::from(std::env::var_os(AGENT_GRAPH_ENV)?);
    let rel = path
        .strip_prefix(&root)
        .map(Path::to_path_buf)
        .or_else(|_| {
            let canonical_root = root.canonicalize()?;
            let canonical = path.canonicalize()?;
            canonical
                .strip_prefix(&canonical_root)
                .map(Path::to_path_buf)
                .map_err(std::io::Error::other)
        });
    let rel = rel.ok()?;
    let parts = rel
        .components()
        .map(|component| match component {
            Component::Normal(part) => part.to_str(),
            _ => None,
        })
        .collect::<Option<Vec<_>>>()?;
    // The runtime directory is local, except its synced part (proposals),
    // which travels like a note so the always-on host's reach the Mac.
    let runtime = parts.first() == Some(&reflect_index_schema::KORE_DIR)
        && parts.get(1) != Some(&reflect_index_schema::SYNCED_SUBDIR);
    if parts.is_empty() || runtime {
        return None;
    }
    Some((root, parts.join("/")))
}

/// Read everything on stdin (the `--stdin` flags), trimmed of trailing
/// line breaks.
pub fn read_stdin() -> Result<String, CliError> {
    let text = std::io::read_to_string(std::io::stdin())
        .map_err(|err| CliError::Runtime(format!("could not read stdin: {err}")))?;
    Ok(text.trim_end_matches(['\n', '\r']).to_string())
}

/// The text a writing command takes either as its argument or on stdin
/// (`--stdin`) — exactly one of the two.
pub fn text_or_stdin(text: Option<&str>, stdin: bool) -> Result<String, CliError> {
    match (text, stdin) {
        (Some(text), false) => Ok(text.to_string()),
        (None, true) => read_stdin(),
        _ => Err(CliError::Usage(
            "give the text as an argument or on stdin (--stdin), not both".to_string(),
        )),
    }
}

/// Read an existing note, run `edit` over its source, and write the result
/// back atomically — only when it changed, so an idempotent command never
/// rewrites a byte. Returns whether a write happened. The caller has already
/// resolved the note and enforced privacy.
pub fn update_note(
    root: &Path,
    rel_path: &str,
    edit: impl FnOnce(&str) -> Result<String, CliError>,
) -> Result<bool, CliError> {
    let absolute = checked_note_path(root, rel_path)?;
    let source = fs::read_to_string(&absolute)
        .map_err(|err| CliError::Runtime(format!("could not read {rel_path}: {err}")))?;
    let next = edit(&source)?;
    if next == source {
        return Ok(false);
    }
    atomic_write(&absolute, &next)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_stage_their_temp_in_the_graph_kore_dir() {
        let graph = tempfile::tempdir().unwrap();
        fs::create_dir(graph.path().join(KORE_DIR)).unwrap();
        let folder = graph.path().join("Projects");
        fs::create_dir(&folder).unwrap();
        assert_eq!(
            staging_dir(&folder),
            graph.path().join(KORE_DIR).join("tmp")
        );

        let note = folder.join("Plan.md");
        atomic_write(&note, "first").unwrap();
        atomic_write(&note, "second").unwrap();
        assert_eq!(fs::read_to_string(&note).unwrap(), "second");
        // Nothing but the note in the synced folder: no stray temp files.
        let entries: Vec<_> = fs::read_dir(&folder).unwrap().collect();
        assert_eq!(entries.len(), 1);
    }

    #[test]
    fn outside_a_graph_the_temp_is_a_sibling() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(staging_dir(dir.path()), dir.path());
        let file = dir.path().join("state.json");
        atomic_write(&file, "{}").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "{}");
    }

    #[test]
    fn create_never_replaces_an_existing_file() {
        let graph = tempfile::tempdir().unwrap();
        fs::create_dir(graph.path().join(KORE_DIR)).unwrap();
        let note = graph.path().join("Note.md");
        atomic_create(&note, "mine").unwrap();
        assert!(matches!(
            atomic_create(&note, "theirs"),
            Err(CreateError::Exists)
        ));
        assert_eq!(fs::read_to_string(&note).unwrap(), "mine");
    }
}
