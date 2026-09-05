//! `reflect list` — notes newest first, with their tags, optionally narrowed
//! to one tag or one kind. Requires the index like `recent` (exit 4); each
//! row's own frontmatter is re-checked on disk so a note flagged private
//! after the last index run never surfaces.

use std::collections::HashMap;

use crate::commands::output::{print_json, ListJson, ListNoteJson};
use crate::commands::{require_index, still_public_on_disk};
use crate::error::CliError;
use crate::graph::Graph;
use crate::keys::fold_tag;

pub fn run(
    graph: &Graph,
    json: bool,
    tag: Option<&str>,
    kind: Option<&str>,
    limit: usize,
) -> Result<(), CliError> {
    let (opened, staleness) = require_index(&graph.root)?;
    let tag_key = tag.map(|tag| fold_tag(tag.trim_start_matches('#')));
    let kind = match kind {
        None => None,
        Some(kind @ ("daily" | "note")) => Some(kind),
        Some(other) => {
            return Err(CliError::Runtime(format!(
                "unknown kind '{other}' — expected daily or note"
            )))
        }
    };

    // Filters are applied in SQL through nullable parameters (`?1 IS NULL OR
    // …`) so one statement serves every combination.
    let mut statement = opened.conn.prepare(
        "SELECT n.path, n.title, n.kind, n.updated_at FROM notes n
         WHERE n.kind IN ('note', 'daily') AND n.is_private = 0
           AND (?1 IS NULL OR n.kind = ?1)
           AND (?2 IS NULL OR EXISTS (
                 SELECT 1 FROM tags t WHERE t.note_path = n.path AND t.tag_key = ?2))
         ORDER BY n.updated_at DESC, n.path",
    )?;
    let rows = statement.query_map(rusqlite::params![kind, tag_key], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, i64>(3)?,
        ))
    })?;
    let mut kept: Vec<(String, String, String, i64)> = Vec::new();
    for row in rows {
        let row = row?;
        if !still_public_on_disk(&graph.root, &row.0) {
            continue;
        }
        kept.push(row);
        if kept.len() >= limit {
            break;
        }
    }

    let mut tags_by_path: HashMap<String, Vec<String>> = HashMap::new();
    if !kept.is_empty() {
        let placeholders = vec!["?"; kept.len()].join(", ");
        let mut tag_statement = opened.conn.prepare(&format!(
            "SELECT note_path, min(tag) FROM tags WHERE note_path IN ({placeholders})
             GROUP BY note_path, tag_key ORDER BY note_path, tag_key"
        ))?;
        let tag_rows = tag_statement.query_map(
            rusqlite::params_from_iter(kept.iter().map(|row| row.0.as_str())),
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )?;
        for row in tag_rows {
            let (path, tag) = row?;
            tags_by_path.entry(path).or_default().push(tag);
        }
    }

    let notes: Vec<ListNoteJson> = kept
        .into_iter()
        .map(|(path, title, kind, updated_ms)| {
            let tags = tags_by_path.remove(&path).unwrap_or_default();
            ListNoteJson {
                updated_at: jiff::Timestamp::from_millisecond(updated_ms)
                    .map(|stamp| stamp.to_string())
                    .unwrap_or_default(),
                path,
                title,
                kind,
                tags,
            }
        })
        .collect();

    if json {
        return print_json(&ListJson {
            stale: staleness.is_stale(),
            notes,
        });
    }
    for note in &notes {
        if note.tags.is_empty() {
            println!("{}\t{}", note.path, note.title);
        } else {
            let tags = note
                .tags
                .iter()
                .map(|tag| format!("#{tag}"))
                .collect::<Vec<_>>()
                .join(" ");
            println!("{}\t{}\t{tags}", note.path, note.title);
        }
    }
    Ok(())
}
