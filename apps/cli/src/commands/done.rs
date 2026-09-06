//! `reflect done <text> [--in <note>] [--undo]` — tick a task off (or back
//! on) by its text. Graph-wide, the index's tasks projection finds the task
//! (exit 4 without it); with `--in`, the note's own lines do, so a task
//! captured a moment ago needs no re-index. The file on disk is the truth
//! for the write: the marker line the index recorded
//! (`tasks.raw`, the line from its `[ ]` onward) must still be present
//! exactly once, else the write refuses rather than toggling the wrong line
//! (the app's `locateTaskMarker` guard). Only the three marker characters
//! change. Requires the index (exit 4); private notes never surface.

use std::fs;
use std::path::Path;

use crate::commands::output::{print_json, DoneJson};
use crate::commands::{
    open_index_for_resolution, require_index, resolve_existing, still_public_on_disk,
};
use crate::error::CliError;
use crate::graph::Graph;
use crate::keys::fold_key;
use crate::write::atomic_write;

struct Candidate {
    path: String,
    text: String,
    raw: String,
    marker_offset: usize,
}

/// One bullet task line as the file holds it: the marker's byte offset and
/// the line from the marker onward (the index's `tasks.raw`).
struct TaskLine {
    marker_offset: usize,
    raw: String,
}

/// Every bullet task line in `source`, in order. Lines inside fenced code
/// (``` or ~~~) never count: a sample of a task in a code block is text, not
/// a task, which is what the app's re-parse guard (`locateTaskMarker`) also
/// refuses to toggle.
fn task_lines(source: &str) -> Vec<TaskLine> {
    let mut lines = Vec::new();
    let mut line_start = 0;
    let mut fence: Option<&str> = None;
    for line in source.split_inclusive('\n') {
        let content = line.trim_end_matches(['\n', '\r']);
        let trimmed = content.trim_start();
        match fence {
            Some(open) => {
                if trimmed.starts_with(open) {
                    fence = None;
                }
            }
            None => {
                if let Some(open) = ["```", "~~~"]
                    .into_iter()
                    .find(|open| trimmed.starts_with(open))
                {
                    fence = Some(open);
                } else if let Some(rest) = trimmed
                    .strip_prefix(['-', '+', '*'])
                    .and_then(|rest| rest.strip_prefix([' ', '\t']))
                {
                    if rest.starts_with("[ ]") || rest.starts_with("[x]") || rest.starts_with("[X]")
                    {
                        lines.push(TaskLine {
                            marker_offset: line_start + content.len() - rest.len(),
                            raw: rest.to_string(),
                        });
                    }
                }
            }
        }
        line_start += line.len();
    }
    lines
}

/// Byte offsets of every task line whose marker line equals `raw` — the
/// positions an indexed task's marker could legitimately have moved to.
fn marker_positions(source: &str, raw: &str) -> Vec<usize> {
    task_lines(source)
        .into_iter()
        .filter(|line| line.raw == raw)
        .map(|line| line.marker_offset)
        .collect()
}

/// The tasks of one note read from the file itself (no index): open ones,
/// or done ones for `--undo`. `text` is the marker line's content, which
/// the same line the index would store as `raw`.
fn file_candidates(root: &Path, rel_path: &str, undo: bool) -> Result<Vec<Candidate>, CliError> {
    let source = fs::read_to_string(root.join(rel_path))
        .map_err(|err| CliError::Runtime(format!("could not read {rel_path}: {err}")))?;
    Ok(task_lines(&source)
        .into_iter()
        .filter(|line| line.raw.starts_with("[ ]") != undo)
        .map(|line| Candidate {
            path: rel_path.to_string(),
            text: line.raw[3..].trim().to_string(),
            marker_offset: line.marker_offset,
            raw: line.raw,
        })
        .collect())
}

/// The graph's tasks from the index projection (private notes excluded).
fn index_candidates(conn: &rusqlite::Connection, undo: bool) -> Result<Vec<Candidate>, CliError> {
    let mut statement = conn.prepare(
        "SELECT tasks.note_path, tasks.text, tasks.raw, tasks.marker_offset
         FROM tasks JOIN notes ON notes.path = tasks.note_path
         WHERE tasks.checked = ?1 AND notes.is_private = 0
         ORDER BY tasks.note_path, tasks.marker_offset",
    )?;
    let rows = statement.query_map([i64::from(undo)], |row| {
        Ok(Candidate {
            path: row.get(0)?,
            text: row.get(1)?,
            raw: row.get(2)?,
            marker_offset: row.get::<_, i64>(3)?.max(0) as usize,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Splice the three marker characters at `offset` (a position
/// `marker_positions` produced, so a marker is there by construction).
fn toggle_marker(source: &str, offset: usize, checked: bool) -> String {
    let next = if checked { "[x]" } else { "[ ]" };
    format!("{}{next}{}", &source[..offset], &source[offset + 3..])
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
    // `--in` reads the note itself, so a task captured a moment ago is
    // tickable before the app re-indexes; the graph-wide search needs the
    // index's tasks projection.
    let candidates = match in_note {
        Some(note_arg) => {
            let index = open_index_for_resolution(&graph.root);
            let rel_path =
                resolve_existing(&graph.root, note_arg, index.as_ref().map(|open| &open.conn))?;
            file_candidates(&graph.root, &rel_path, undo)?
        }
        None => {
            let (opened, _staleness) = require_index(&graph.root)?;
            index_candidates(&opened.conn, undo)?
        }
    };

    let folded = fold_key(wanted);
    let exact: Vec<&Candidate> = candidates
        .iter()
        .filter(|candidate| fold_key(&candidate.text) == folded)
        .collect();
    let matches = if exact.is_empty() {
        candidates
            .iter()
            .filter(|candidate| fold_key(&candidate.text).contains(&folded))
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
    let next = toggle_marker(&source, offset, !undo);
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
    fn finds_marker_positions_by_the_indexed_raw_line_outside_code_fences() {
        let source = "# T\n+ [ ] pay bill\n  - [ ] pay bill\n+ [x] other\nprose [ ] pay bill\n";
        assert_eq!(marker_positions(source, "[ ] pay bill"), vec![6, 23]);
        assert_eq!(marker_positions(source, "[x] other"), vec![38]);
        assert!(marker_positions(source, "[ ] nope").is_empty());
        let fenced = "# T\n```md\n+ [ ] pay bill\n```\n~~~\n+ [ ] pay bill\n~~~\n+ [ ] pay bill\n";
        assert_eq!(marker_positions(fenced, "[ ] pay bill"), vec![54]);
    }

    #[test]
    fn task_lines_read_open_and_done_markers() {
        let source = "+ [ ] open\n- [x] done\n* [X] also done\n- plain bullet\n";
        let raws: Vec<String> = task_lines(source)
            .into_iter()
            .map(|line| line.raw)
            .collect();
        assert_eq!(raws, ["[ ] open", "[x] done", "[X] also done"]);
    }

    #[test]
    fn toggles_only_the_marker() {
        assert_eq!(
            toggle_marker("+ [ ] pay bill\n", 2, true),
            "+ [x] pay bill\n"
        );
    }
}
