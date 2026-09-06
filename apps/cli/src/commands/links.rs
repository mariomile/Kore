//! `reflect links <note>` — the wiki links a note makes, in document order,
//! each resolved to the note that answers to it through the index's
//! `note_keys` view (the app's own link resolution), or `path: null` when
//! nothing does. Requires the index (exit 4). A private source is refused;
//! a link whose target turns out private on disk is dropped, so neither its
//! path nor its title can surface.

use std::collections::HashSet;

use crate::commands::output::{print_json, LinkJson, LinksJson};
use crate::commands::{require_index, still_public_on_disk};
use crate::error::CliError;
use crate::graph::Graph;
use crate::note_file::ensure_not_private;
use crate::resolve::resolve_note;

pub fn run(graph: &Graph, json: bool, note_arg: &str) -> Result<(), CliError> {
    let (opened, staleness) = require_index(&graph.root)?;
    let resolved = resolve_note(note_arg, &graph.root, Some(&opened.conn))?;
    let rel_path = resolved.rel_path().to_string();
    ensure_not_private(&graph.root, &rel_path)?;

    let mut statement = opened.conn.prepare(
        "SELECT l.target_raw, l.target_key, k.note_path, n.title, n.is_private
         FROM links l
         LEFT JOIN note_keys k ON k.key = l.target_key
         LEFT JOIN notes n ON n.path = k.note_path
         WHERE l.source_path = ?1 AND l.kind = 'wiki'
         ORDER BY l.pos_from, k.note_path",
    )?;
    let rows = statement.query_map([&rel_path], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, Option<i64>>(4)?,
        ))
    })?;

    // One entry per distinct target; a key several notes answer to keeps
    // the first path in path order (deterministic, like `resolve_note`).
    let mut seen: HashSet<String> = HashSet::new();
    let mut links: Vec<LinkJson> = Vec::new();
    for row in rows {
        let (target, target_key, path, title, is_private) = row?;
        if !seen.insert(target_key) {
            continue;
        }
        match path {
            Some(path) => {
                if is_private == Some(1) || !still_public_on_disk(&graph.root, &path) {
                    continue;
                }
                links.push(LinkJson {
                    target,
                    path: Some(path),
                    title,
                });
            }
            None => links.push(LinkJson {
                target,
                path: None,
                title: None,
            }),
        }
    }

    if json {
        return print_json(&LinksJson {
            path: &rel_path,
            stale: staleness.is_stale(),
            links,
        });
    }
    for link in &links {
        match &link.path {
            Some(path) => println!("{}\t{path}", link.target),
            None => println!("{}\t(unresolved)", link.target),
        }
    }
    Ok(())
}
