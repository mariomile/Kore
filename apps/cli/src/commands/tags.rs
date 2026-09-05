//! `reflect tags` — every tag in the graph with its public note count and
//! whether it is typed (a collection with a schema at `tags/<tag>.md`). The
//! facet mirrors `graph-stats.ts`: grouped on the folded `tag_key`, one
//! deterministic display casing (`min(tag)`), counted over non-private
//! notes and dailies. Requires the index (exit 4). Counts come from index
//! rows — a just-flagged private note is at most one count off until the
//! app re-indexes; no content or path of such a note can surface here.

use crate::commands::output::{print_json, TagJson, TagsJson};
use crate::commands::require_index;
use crate::error::CliError;
use crate::graph::Graph;

pub fn run(graph: &Graph, json: bool) -> Result<(), CliError> {
    let (opened, staleness) = require_index(&graph.root)?;
    let mut statement = opened.conn.prepare(
        "SELECT min(tags.tag), count(*), tag_types.note_path
         FROM tags
         JOIN notes ON notes.path = tags.note_path
         LEFT JOIN tag_types ON tag_types.tag_key = tags.tag_key
         WHERE notes.kind IN ('note', 'daily') AND notes.is_private = 0
         GROUP BY tags.tag_key
         ORDER BY count(*) DESC, tags.tag_key",
    )?;
    let tags = statement
        .query_map([], |row| {
            let definition: Option<String> = row.get(2)?;
            Ok(TagJson {
                tag: row.get(0)?,
                count: row.get(1)?,
                typed: definition.is_some(),
                definition,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    if json {
        return print_json(&TagsJson {
            stale: staleness.is_stale(),
            tags,
        });
    }
    for tag in &tags {
        let typed = if tag.typed { "\tcollection" } else { "" };
        println!("#{}\t{}{typed}", tag.tag, tag.count);
    }
    Ok(())
}
