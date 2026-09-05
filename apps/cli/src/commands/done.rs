//! `reflect done <text> [--in <note>] [--undo]` — tick a task off (or back
//! on) by its text. The index's tasks projection finds the task; the file
//! on disk is the truth for the write: the marker line the index recorded
//! (`tasks.raw`, the line from its `[ ]` onward) must still be present
//! exactly once, else the write refuses rather than toggling the wrong line
//! (the app's `locateTaskMarker` guard). Only the three marker characters
//! change. Requires the index (exit 4); private notes never surface.

use std::fs;

use crate::commands::output::{print_json, DoneJson};
use crate::commands::{require_index, resolve_existing, still_public_on_disk};
use crate::error::CliError;
use crate::graph::Graph;
use crate::write::atomic_write;

struct Candidate {
    path: String,
    text: String,
    raw: String,
    marker_offset: usize,
}

/// Byte offsets of every line that is a bullet task whose marker line
/// equals `raw` — the positions the marker could legitimately have moved to.
fn marker_positions(source: &str, raw: &str) -> Vec<usize> {
    let mut positions = Vec::new();
    let mut line_start = 0;
    for line in source.split_inclusive('\n') {
        let content = line.trim_end_matches(['\n', '\r']);
        let indent = content.len() - content.trim_start().len();
        let after_indent = &content[indent..];
        if let Some(rest) = after_indent
            .strip_prefix(['-', '+', '*'])
            .and_then(|rest| rest.strip_prefix([' ', '\t']))
        {
            let marker_at = content.len() - rest.len();
            if rest == raw {
                positions.push(line_start + marker_at);
            }
        }
        line_start += line.len();
    }
    positions
}

fn toggle_marker(source: &str, offset: usize, checked: bool) -> Result<String, CliError> {
    let marker = source.get(offset..offset + 3).unwrap_or("");
    if !matches!(marker, "[ ]" | "[x]" | "[X]") {
        return Err(CliError::Runtime(format!(
            "no task marker at offset {offset} — reopen the graph in Kore to refresh the index"
        )));
    }
    let next = if checked { "[x]" } else { "[ ]" };
    Ok(format!(
        "{}{next}{}",
        &source[..offset],
        &source[offset + 3..]
    ))
}

pub fn run(
    graph: &Graph,
    json: bool,
    text_arg: &str,
    in_note: Option<&str>,
    undo: bool,
) -> Result<(), CliError> {
    let wanted = text_arg.trim();
    if wanted.is_empty() {
        return Err(CliError::Usage("give the task's text".to_string()));
    }
    let (opened, _staleness) = require_index(&graph.root)?;
    let scope = match in_note {
        Some(note_arg) => Some(resolve_existing(&graph.root, note_arg, Some(&opened.conn))?),
        None => None,
    };

    let mut statement = opened.conn.prepare(
        "SELECT tasks.note_path, tasks.text, tasks.raw, tasks.marker_offset
         FROM tasks JOIN notes ON notes.path = tasks.note_path
         WHERE tasks.checked = ?1 AND notes.is_private = 0
           AND (?2 IS NULL OR tasks.note_path = ?2)
         ORDER BY tasks.note_path, tasks.marker_offset",
    )?;
    let rows = statement.query_map(rusqlite::params![i64::from(undo), scope], |row| {
        Ok(Candidate {
            path: row.get(0)?,
            text: row.get(1)?,
            raw: row.get(2)?,
            marker_offset: row.get::<_, i64>(3)?.max(0) as usize,
        })
    })?;
    let candidates: Vec<Candidate> = rows.collect::<Result<_, _>>()?;

    let folded = wanted.to_lowercase();
    let exact: Vec<&Candidate> = candidates
        .iter()
        .filter(|candidate| candidate.text.trim().to_lowercase() == folded)
        .collect();
    let matches = if exact.is_empty() {
        candidates
            .iter()
            .filter(|candidate| candidate.text.to_lowercase().contains(&folded))
            .collect::<Vec<_>>()
    } else {
        exact
    };
    let state = if undo { "done" } else { "open" };
    let task = match matches.as_slice() {
        [] => {
            return Err(CliError::NotFound(format!(
                "no {state} task matching '{wanted}'"
            )))
        }
        [task] => *task,
        several => {
            for candidate in several {
                eprintln!("reflect: {}\t{}", candidate.path, candidate.text);
            }
            return Err(CliError::NotFound(format!(
                "'{wanted}' matches {} {state} tasks — give more of the text or --in <note>",
                several.len()
            )));
        }
    };
    if !still_public_on_disk(&graph.root, &task.path) {
        return Err(CliError::NotFound(format!(
            "no {state} task matching '{wanted}'"
        )));
    }

    let absolute = graph.root.join(&task.path);
    let source = fs::read_to_string(&absolute)
        .map_err(|err| CliError::Runtime(format!("could not read {}: {err}", task.path)))?;
    let positions = marker_positions(&source, &task.raw);
    let offset = if positions.contains(&task.marker_offset) {
        task.marker_offset
    } else {
        match positions.as_slice() {
            [only] => *only,
            _ => {
                return Err(CliError::Runtime(format!(
                    "the task line no longer matches the index in {} — reopen the graph in Kore to refresh it",
                    task.path
                )))
            }
        }
    };
    let next = toggle_marker(&source, offset, !undo)?;
    atomic_write(&absolute, &next)?;

    if json {
        return print_json(&DoneJson {
            path: &task.path,
            text: &task.text,
            checked: !undo,
        });
    }
    println!("{}", absolute.display());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_marker_positions_by_the_indexed_raw_line() {
        let source = "# T\n+ [ ] pay bill\n  - [ ] pay bill\n+ [x] other\nprose [ ] pay bill\n";
        assert_eq!(marker_positions(source, "[ ] pay bill"), vec![6, 23]);
        assert_eq!(marker_positions(source, "[x] other"), vec![38]);
        assert!(marker_positions(source, "[ ] nope").is_empty());
    }

    #[test]
    fn toggles_only_the_marker() {
        let source = "+ [ ] pay bill\n";
        assert_eq!(toggle_marker(source, 2, true).unwrap(), "+ [x] pay bill\n");
        assert!(toggle_marker(source, 0, true).is_err());
    }
}
