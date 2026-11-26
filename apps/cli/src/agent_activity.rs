//! The live log of what agents do in the vault while they do it
//! (`.kore/agent-activity.jsonl`, one JSON object per line): the notes a
//! tool call opened and the passage each write changed. The app tails it to
//! show an agent at work and offer Undo; what to show and how to undo is
//! its policy (`@kore/core`, `ai/agent-activity.ts`). Local to the machine
//! like the rest of `.kore/`, appended only by the child that runs a tool
//! call for an agent, and kept small by rotation.

use std::fs;
use std::io::Write;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

use crate::write::{current_agent, graph_relative};

/// Graph-relative location of the log.
pub const AGENT_ACTIVITY: &str = ".kore/agent-activity.jsonl";

/// Set by `kore mcp` on a tool call's child: the MCP client's own name
/// (`clientInfo.name`, e.g. `claude-code`), so the app can name an agent
/// that called without one.
pub const AGENT_CLIENT_ENV: &str = "KORE_AGENT_CLIENT";

/// Past this size the log starts over: the app only ever needs the last
/// few minutes, and it notices the restart (the file got shorter).
const MAX_BYTES: u64 = 256 * 1024;

/// An agent opened the note at `path` (`kore show`, `kore today`).
pub fn record_read(path: &Path) {
    record(path, json!({ "kind": "read" }));
}

/// An agent changed the note at `path` from `before` to `after` (`before`
/// is empty for a note it created). Records only the lines that changed,
/// with the unchanged line on either side so the change can be found again
/// to take it back.
pub fn record_write(path: &Path, before: &str, after: &str) {
    if before == after {
        return;
    }
    let change = changed_lines(before, after);
    record(
        path,
        json!({
            "kind": "write",
            "created": before.is_empty(),
            "removed": change.removed,
            "added": change.added,
            "contextBefore": change.context_before,
            "contextAfter": change.context_after,
        }),
    );
}

/// The middle of a two-version text that differs, in whole lines.
#[derive(Debug, PartialEq, Eq)]
struct LineChange {
    removed: String,
    added: String,
    /// The unchanged line just before the change ("" at the start).
    context_before: String,
    /// The unchanged line just after it ("" at the end).
    context_after: String,
}

fn changed_lines(before: &str, after: &str) -> LineChange {
    let old: Vec<&str> = before.split_inclusive('\n').collect();
    let new: Vec<&str> = after.split_inclusive('\n').collect();
    let prefix = old.iter().zip(&new).take_while(|(a, b)| a == b).count();
    let suffix = old[prefix..]
        .iter()
        .rev()
        .zip(new[prefix..].iter().rev())
        .take_while(|(a, b)| a == b)
        .count();
    LineChange {
        removed: old[prefix..old.len() - suffix].concat(),
        added: new[prefix..new.len() - suffix].concat(),
        context_before: prefix
            .checked_sub(1)
            .map_or_else(String::new, |at| old[at].to_string()),
        context_after: old
            .get(old.len() - suffix)
            .filter(|_| suffix > 0)
            .map_or_else(String::new, |line| (*line).to_string()),
    }
}

/// Append one event for the agent this process runs a tool call for. Best
/// effort: the log only feeds the live view, so a failure never fails the
/// command.
fn record(path: &Path, mut event: Value) {
    let Some(agent) = current_agent() else {
        return;
    };
    let Some((root, rel_path)) = graph_relative(path) else {
        return;
    };
    let at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or_default();
    event["at"] = json!(at);
    event["agent"] = json!(agent.name);
    event["path"] = json!(rel_path);
    if let Some(client) = std::env::var(AGENT_CLIENT_ENV)
        .ok()
        .filter(|client| !client.trim().is_empty())
    {
        event["client"] = json!(client);
    }
    let log = root.join(AGENT_ACTIVITY);
    let appended = log
        .parent()
        .map_or(Ok(()), fs::create_dir_all)
        .and_then(|()| {
            if fs::metadata(&log).is_ok_and(|meta| meta.len() > MAX_BYTES) {
                fs::remove_file(&log)?;
            }
            fs::OpenOptions::new().create(true).append(true).open(&log)
        })
        .and_then(|mut file| writeln!(file, "{event}"));
    if let Err(err) = appended {
        eprintln!("kore: could not record agent activity in {AGENT_ACTIVITY}: {err}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn change(before: &str, after: &str) -> LineChange {
        changed_lines(before, after)
    }

    #[test]
    fn an_append_is_the_new_lines_after_the_last_one() {
        assert_eq!(
            change("- one\n- two\n", "- one\n- two\n- three\n"),
            LineChange {
                removed: String::new(),
                added: "- three\n".to_string(),
                context_before: "- two\n".to_string(),
                context_after: String::new(),
            }
        );
    }

    #[test]
    fn an_edit_in_the_middle_keeps_a_line_on_either_side() {
        assert_eq!(
            change("a\nb\nc\n", "a\nB\nB2\nc\n"),
            LineChange {
                removed: "b\n".to_string(),
                added: "B\nB2\n".to_string(),
                context_before: "a\n".to_string(),
                context_after: "c\n".to_string(),
            }
        );
    }

    #[test]
    fn a_new_note_is_all_added() {
        let created = change("", "# Plan\n");
        assert_eq!(created.added, "# Plan\n");
        assert_eq!(created.removed, "");
        assert_eq!(created.context_before, "");
    }

    #[test]
    fn repeated_lines_never_overlap_prefix_and_suffix() {
        let repeated = change("x\nx\n", "x\nx\nx\n");
        assert_eq!(repeated.added, "x\n");
        assert_eq!(repeated.removed, "");
    }
}
