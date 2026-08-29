//! `reflect backlinks <note>` — the notes linking *to* a note, read from the
//! index's `backlinks` view (the same resolution the app's Backlinks panel
//! uses: ranked wiki-name joins with exact-file-first fallback, templates
//! excluded). Requires the index like `search`/`tasks` (exit 4 when
//! missing). A private target is refused like every other surface, and each
//! source note's own frontmatter is re-checked on disk before it surfaces.

use std::collections::HashMap;

use reflect_index_schema::{INDEX_FILE, REFLECT_DIR};

use crate::commands::output::{print_json, BacklinkJson, BacklinksJson};
use crate::commands::{still_public_on_disk, warn};
use crate::error::CliError;
use crate::graph::Graph;
use crate::index::{detect_staleness, open_read_only, IndexOpen};
use crate::note_file::{ensure_not_private, parse_note_meta};
use crate::resolve::resolve_note;

pub fn run(graph: &Graph, json: bool, note_arg: &str) -> Result<(), CliError> {
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

    let resolved = resolve_note(note_arg, &graph.root, Some(&opened.conn))?;
    let rel_path = resolved.rel_path().to_string();
    ensure_not_private(&graph.root, &rel_path)?;

    let staleness = detect_staleness(&opened.conn, &graph.root)?;
    if staleness.is_stale() {
        warn(format!(
            "the index may be stale ({} file(s) differ from it) — open the graph in Kore to refresh",
            staleness.total()
        ));
    }

    let mut statement = opened.conn.prepare(
        "SELECT backlinks.source_path, notes.title, COUNT(*)
         FROM backlinks JOIN notes ON notes.path = backlinks.source_path
         WHERE backlinks.target_path = ?1 AND backlinks.source_path != ?1
         GROUP BY backlinks.source_path, notes.title
         ORDER BY backlinks.source_path",
    )?;
    let rows = statement.query_map([&rel_path], |row| {
        Ok(BacklinkJson {
            path: row.get(0)?,
            title: row.get(1)?,
            count: row.get(2)?,
        })
    })?;

    let mut public: HashMap<String, bool> = HashMap::new();
    let mut backlinks: Vec<BacklinkJson> = Vec::new();
    for row in rows {
        let row = row?;
        let keep = *public
            .entry(row.path.clone())
            .or_insert_with_key(|path| still_public_on_disk(&graph.root, path));
        if keep {
            backlinks.push(row);
        }
    }

    // The target's display title, from the file itself (works for dailies
    // and notes alike; the daily's title is its date-shaped stem).
    let title = match std::fs::read_to_string(graph.root.join(&rel_path)) {
        Ok(content) => parse_note_meta(&rel_path, &content).title,
        Err(_) => String::new(),
    };

    if json {
        return print_json(&BacklinksJson {
            path: &rel_path,
            title: &title,
            stale: staleness.is_stale(),
            backlinks,
        });
    }
    for backlink in &backlinks {
        if backlink.count > 1 {
            println!(
                "{}\t{}\t({} links)",
                backlink.path, backlink.title, backlink.count
            );
        } else {
            println!("{}\t{}", backlink.path, backlink.title);
        }
    }
    Ok(())
}
