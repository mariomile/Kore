//! `reflect recent` — the most recently updated notes, from the index
//! (templates excluded), newest first. Requires the index like
//! `search`/`tasks` (exit 4 when missing); each row's own frontmatter is
//! re-checked on disk so a note flagged private after the last index run
//! never surfaces.

use crate::commands::output::{print_json, RecentJson, RecentNoteJson};
use crate::commands::{require_index, still_public_on_disk};
use crate::error::CliError;
use crate::graph::Graph;

pub fn run(graph: &Graph, json: bool, limit: usize) -> Result<(), CliError> {
    let (opened, staleness) = require_index(&graph.root)?;

    let mut statement = opened.conn.prepare(
        "SELECT path, title, updated_at FROM notes
         WHERE kind != 'template' AND is_private = 0
         ORDER BY updated_at DESC, path",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i64>(2)?,
        ))
    })?;

    let mut notes: Vec<RecentNoteJson> = Vec::new();
    for row in rows {
        let (path, title, updated_ms) = row?;
        if !still_public_on_disk(&graph.root, &path) {
            continue;
        }
        let updated_at = jiff::Timestamp::from_millisecond(updated_ms)
            .map(|stamp| stamp.to_string())
            .unwrap_or_default();
        notes.push(RecentNoteJson {
            path,
            title,
            updated_at,
        });
        if notes.len() >= limit {
            break;
        }
    }

    if json {
        return print_json(&RecentJson {
            stale: staleness.is_stale(),
            notes,
        });
    }
    for note in &notes {
        println!("{}\t{}", note.path, note.title);
    }
    Ok(())
}
