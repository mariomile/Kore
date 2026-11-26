//! The live log `kore mcp` keeps of what agents do in the vault
//! (`.kore/agent-activity.jsonl`). One capability: hand back the complete
//! lines appended since a byte offset, so the app can tail the log cheaply
//! (a `stat` when nothing changed). What the lines mean is `@kore/core`
//! (`ai/agent-activity.ts`).

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use serde::Serialize;
use tauri::State;

use crate::blocking::run_blocking;
use crate::error::AppResult;
use crate::fs::{root_for_generation, GraphState};

/// Graph-relative location of the log (the CLI's `AGENT_ACTIVITY`).
const LOG: &str = ".kore/agent-activity.jsonl";

/// Most bytes one read hands back. The CLI starts the log over well before
/// this, so only a reader that fell far behind is cut short (to the newest
/// part, which is all the live view needs).
const MAX_READ: u64 = 512 * 1024;

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityChunk {
    /// Complete lines appended since the offset asked for ("" when none).
    pub text: String,
    /// Where the next read starts.
    pub offset: u64,
}

/// Lines from `offset` to the last complete line. A log shorter than
/// `offset` was started over, so reading restarts at its beginning; a
/// missing log is empty.
fn read_since(root: &Path, offset: u64) -> AppResult<ActivityChunk> {
    let mut file = match File::open(root.join(LOG)) {
        Ok(file) => file,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ActivityChunk {
                text: String::new(),
                offset: 0,
            })
        }
        Err(err) => return Err(err.into()),
    };
    let len = file.metadata()?.len();
    let from = if len < offset { 0 } else { offset };
    if from == len {
        return Ok(ActivityChunk {
            text: String::new(),
            offset: len,
        });
    }
    let from = from.max(len.saturating_sub(MAX_READ));
    file.seek(SeekFrom::Start(from))?;
    let mut bytes = Vec::new();
    file.take(len - from).read_to_end(&mut bytes)?;
    // A line still being appended waits for the next read.
    let complete = bytes
        .iter()
        .rposition(|&byte| byte == b'\n')
        .map_or(0, |at| at + 1);
    bytes.truncate(complete);
    Ok(ActivityChunk {
        offset: from + complete as u64,
        text: String::from_utf8_lossy(&bytes).into_owned(),
    })
}

/// Command: the agent activity appended since `offset` in the graph of
/// `generation`.
#[tauri::command]
pub async fn agent_activity_since(
    offset: u64,
    generation: u64,
    graph: State<'_, GraphState>,
) -> AppResult<ActivityChunk> {
    let root = root_for_generation(&graph, generation)?;
    run_blocking(move || read_since(&root, offset)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;

    #[test]
    fn tails_complete_lines_and_restarts_when_the_log_starts_over() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        assert_eq!(read_since(root, 0).unwrap().offset, 0);

        fs::create_dir(root.join(".kore")).unwrap();
        let log = root.join(LOG);
        fs::write(&log, "{\"a\":1}\n{\"b\":").unwrap();
        let first = read_since(root, 0).unwrap();
        assert_eq!(first.text, "{\"a\":1}\n");
        assert_eq!(first.offset, 8);
        assert_eq!(read_since(root, first.offset).unwrap().text, "");

        let mut file = fs::OpenOptions::new().append(true).open(&log).unwrap();
        writeln!(file, "2}}").unwrap();
        let second = read_since(root, first.offset).unwrap();
        assert_eq!(second.text, "{\"b\":2}\n");

        fs::write(&log, "{\"c\":3}\n").unwrap();
        let restarted = read_since(root, second.offset).unwrap();
        assert_eq!(restarted.text, "{\"c\":3}\n");
    }
}
