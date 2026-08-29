//! `reflect recent` — the most recently updated notes, from the index
//! (templates excluded), newest first. Requires the index like
//! `search`/`tasks` (exit 4 when missing); each row's own frontmatter is
//! re-checked on disk so a note flagged private after the last index run
//! never surfaces.

use reflect_index_schema::{INDEX_FILE, REFLECT_DIR};

use crate::commands::output::{print_json, RecentJson, RecentNoteJson};
use crate::commands::{still_public_on_disk, warn};
use crate::error::CliError;
use crate::graph::Graph;
use crate::index::{detect_staleness, open_read_only, IndexOpen};

pub fn run(graph: &Graph, json: bool, limit: usize) -> Result<(), CliError> {
    let opened = match open_read_only(&graph.root) {
        IndexOpen::Opened(opened) => opened,
        IndexOpen::Missing => {
            return Err(CliError::NoIndex(format!(
                "no index at {REFLECT_DIR}/{INDEX_FILE} — open this graph in Kore to build it"
            )))
        }
        IndexOpen::Unusable(message) => return Err(CliError::NoIndex(message)),
    };
    if opened.newer_schema {
        warn("the index schema is newer than this CLI — update Kore");
    }

    let staleness = detect_staleness(&opened.conn, &graph.root)?;
    if staleness.is_stale() {
        warn(format!(
            "the index may be stale ({} file(s) differ from it) — open the graph in Kore to refresh",
            staleness.total()
        ));
    }

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
