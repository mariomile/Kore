//! `reflect backlinks <note>` — the notes linking *to* a note, read from the
//! index's `backlinks` view (the same resolution the app's Backlinks panel
//! uses: ranked wiki-name joins with exact-file-first fallback, templates
//! excluded). Requires the index like `search`/`tasks` (exit 4 when
//! missing). A private target is refused like every other surface, and each
//! source note's own frontmatter is re-checked on disk before it surfaces.

use std::collections::HashMap;

use crate::commands::output::{print_json, BacklinkJson, BacklinksJson};
use crate::commands::{require_index, still_public_on_disk};
use crate::error::CliError;
use crate::graph::Graph;
use crate::note_file::{ensure_not_private, parse_note_meta};
use crate::resolve::resolve_note;

pub fn run(graph: &Graph, json: bool, note_arg: &str) -> Result<(), CliError> {
    let (opened, staleness) = require_index(&graph.root)?;
    let resolved = resolve_note(note_arg, &graph.root, Some(&opened.conn))?;
    let rel_path = resolved.rel_path().to_string();
    ensure_not_private(&graph.root, &rel_path)?;

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
