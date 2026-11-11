//! The journal `kore mcp` keeps of the notes each agent wrote
//! (`.kore/agent-writes.jsonl`, one JSON object per line). Reading and
//! trimming it are primitives; deciding how to commit the entries is the
//! sync engine's policy in `@kore/core`.

use std::fs;
use std::io::Write;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::AppResult;

/// Graph-relative location of the journal.
const JOURNAL: &str = ".kore/agent-writes.jsonl";

/// One recorded write.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentWrite {
    /// Milliseconds since the Unix epoch.
    pub at: u64,
    /// The agent's name and commit address, as `kore mcp` resolved them.
    pub agent: String,
    pub email: String,
    /// Graph-relative path the agent wrote.
    pub path: String,
}

/// What the journal holds now.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentWrites {
    pub writes: Vec<AgentWrite>,
    /// Lines read, malformed ones included: pass it back to [`clear`] to
    /// drop exactly what was read.
    pub lines: usize,
}

/// Read the journal. A missing journal is empty; a malformed line is
/// skipped (but counted, so clearing drops it too).
pub(super) fn read(root: &Path) -> AppResult<AgentWrites> {
    let text = match fs::read_to_string(root.join(JOURNAL)) {
        Ok(text) => text,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(err) => return Err(err.into()),
    };
    let lines: Vec<&str> = text.lines().collect();
    let writes = lines
        .iter()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect();
    Ok(AgentWrites {
        writes,
        lines: lines.len(),
    })
}

/// Drop the first `lines` lines, keeping anything appended since they were
/// read.
pub(super) fn clear(root: &Path, lines: usize) -> AppResult<()> {
    let path = root.join(JOURNAL);
    let text = match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(err) => return Err(err.into()),
    };
    let rest: Vec<&str> = text.lines().skip(lines).collect();
    if rest.is_empty() {
        fs::remove_file(&path)?;
        return Ok(());
    }
    let dir = path.parent().unwrap_or(root);
    let mut tmp = tempfile::NamedTempFile::new_in(dir)?;
    for line in rest {
        writeln!(tmp, "{line}")?;
    }
    tmp.flush()?;
    tmp.persist(&path).map_err(|err| err.error)?;
    Ok(())
}
