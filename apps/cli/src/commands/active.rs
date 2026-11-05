//! `kore active`: the note the user has in front of them in the Kore app,
//! and the note tabs they have open, so an agent asked about "this note"
//! knows which one. The desktop app writes `.reflect/workspace.json` as the
//! tabs change; this reads it. Works without an index. A note that is
//! private, gone, or only an iCloud placeholder is left out.

use serde::Deserialize;

use crate::commands::output::{print_json, ActiveJson, RouteNoteJson};
use crate::error::CliError;
use crate::graph::Graph;
use crate::note_file::read_note;

/// The state file, inside the graph's `.reflect/` directory.
pub const WORKSPACE_FILE: &str = "workspace.json";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFile {
    version: u32,
    active_note: Option<String>,
    #[serde(default)]
    open_notes: Vec<String>,
    updated_at: String,
}

pub fn run(graph: &Graph, json: bool) -> Result<(), CliError> {
    let file = graph
        .root
        .join(reflect_index_schema::REFLECT_DIR)
        .join(WORKSPACE_FILE);
    let text = std::fs::read_to_string(&file).map_err(|_| {
        CliError::NotFound(
            "the Kore app has not shared its open notes for this graph: open it in Kore"
                .to_string(),
        )
    })?;
    let workspace: WorkspaceFile = serde_json::from_str(&text)
        .map_err(|err| CliError::runtime(format!("could not read {WORKSPACE_FILE}: {err}")))?;
    if workspace.version != 1 {
        return Err(CliError::runtime(format!(
            "{WORKSPACE_FILE} is version {}; update the kore CLI",
            workspace.version
        )));
    }

    let readable = |rel_path: &str| {
        read_note(&graph.root, rel_path)
            .ok()
            .map(|note| RouteNoteJson {
                path: rel_path.to_string(),
                title: note.meta.title,
            })
    };
    let active_note = workspace.active_note.as_deref().and_then(readable);
    let open_notes: Vec<RouteNoteJson> = workspace
        .open_notes
        .iter()
        .filter_map(|rel_path| readable(rel_path))
        .collect();

    if json {
        return print_json(&ActiveJson {
            active_note,
            open_notes,
            updated_at: workspace.updated_at,
        });
    }
    match &active_note {
        Some(note) => println!("active\t{}\t{}", note.path, note.title),
        None => println!("active\t(none)"),
    }
    for note in &open_notes {
        println!("open\t{}\t{}", note.path, note.title);
    }
    Ok(())
}
