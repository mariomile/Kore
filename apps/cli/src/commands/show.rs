//! `reflect show <note>` — resolve by date, path, title, or alias and print
//! the raw markdown. Index-assisted when the index is present; file-scan
//! fallback when it isn't (the command works with no index at all).

use crate::commands::output::{print_content, print_json, NoteJson};
use crate::commands::{open_index_for_resolution, resolve_existing};
use crate::error::CliError;
use crate::graph::Graph;
use crate::note_file::read_note;
use crate::paths::date_from_daily_path;

pub fn run(graph: &Graph, json: bool, note_arg: &str) -> Result<(), CliError> {
    let index = open_index_for_resolution(&graph.root);
    let rel_path = resolve_existing(&graph.root, note_arg, index.as_ref().map(|open| &open.conn))?;
    let rel_path = rel_path.as_str();
    let note = read_note(&graph.root, rel_path)?;
    if json {
        return print_json(&NoteJson {
            date: date_from_daily_path(rel_path),
            path: rel_path,
            absolute_path: graph.root.join(rel_path).display().to_string(),
            title: &note.meta.title,
            content: &note.content,
        });
    }
    print_content(&note.content);
    Ok(())
}
