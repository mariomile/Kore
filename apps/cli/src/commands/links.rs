//! `kore links <note>` — the wiki links a note makes, in document order,
//! each resolved to the note that answers to it through the index's
//! `note_keys` view (the app's own link resolution), or `path: null` when
//! nothing does. Requires the index (exit 4). A private source is refused;
//! a link whose target turns out private on disk is dropped, so neither its
//! path nor its title can surface. Each link names its relations (the
//! frontmatter keys it is the value of); `--relation` keeps only those.

use std::collections::HashMap;
use std::path::Path;

use crate::commands::output::{print_json, LinkJson, LinksJson};
use crate::commands::{require_index, still_public_on_disk};
use crate::error::CliError;
use crate::graph::Graph;
use crate::link_context::{links_have_relation, relation_column, same_relation};
use crate::note_file::ensure_not_private;
use crate::resolve::resolve_note;

pub fn run(
    graph: &Graph,
    json: bool,
    note_arg: &str,
    relation: Option<&str>,
) -> Result<(), CliError> {
    let (opened, staleness) = require_index(&graph.root)?;
    let resolved = resolve_note(note_arg, &graph.root, Some(&opened.conn))?;
    let rel_path = resolved.rel_path().to_string();
    ensure_not_private(&graph.root, &rel_path)?;
    let links = collect(&graph.root, &opened.conn, &rel_path, relation)?;

    if json {
        return print_json(&LinksJson {
            path: &rel_path,
            stale: staleness.is_stale(),
            links,
        });
    }
    for link in &links {
        let relations = if link.relations.is_empty() {
            String::new()
        } else {
            format!("\t({})", link.relations.join(", "))
        };
        match &link.path {
            Some(path) => println!("{}\t{path}{relations}", link.target),
            None => println!("{}\t(unresolved){relations}", link.target),
        }
    }
    Ok(())
}

/// The note's distinct wiki links in document order, private targets
/// dropped, each with the relations it carries. With `relation`, only the
/// links made under that frontmatter key (case-insensitive). The caller has
/// already refused a private source.
pub(crate) fn collect(
    root: &Path,
    conn: &rusqlite::Connection,
    rel_path: &str,
    relation: Option<&str>,
) -> Result<Vec<LinkJson>, CliError> {
    let relation_sql = relation_column(links_have_relation(conn), "l");
    let mut statement = conn.prepare(&format!(
        "SELECT l.target_raw, l.target_key, k.note_path, n.title, n.is_private, {relation_sql}
         FROM links l
         LEFT JOIN note_keys k ON k.key = l.target_key
         LEFT JOIN notes n ON n.path = k.note_path
         WHERE l.source_path = ?1 AND l.kind = 'wiki'
         ORDER BY l.pos_from, k.note_path"
    ))?;
    let rows = statement.query_map([rel_path], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, Option<i64>>(4)?,
            row.get::<_, Option<String>>(5)?,
        ))
    })?;

    // One entry per distinct target; a key several notes answer to keeps
    // the first path in path order (deterministic, like `resolve_note`). A
    // target linked both as a relation and in the body is one entry naming
    // every relation it carries.
    let mut position: HashMap<String, Option<usize>> = HashMap::new();
    let mut links: Vec<LinkJson> = Vec::new();
    for row in rows {
        let (target, target_key, path, title, is_private, row_relation) = row?;
        let slot = match position.get(&target_key) {
            Some(slot) => *slot,
            None => {
                let slot = match path {
                    Some(path) => {
                        if is_private == Some(1) || !still_public_on_disk(root, &path) {
                            None
                        } else {
                            links.push(LinkJson {
                                target,
                                path: Some(path),
                                title,
                                relations: Vec::new(),
                            });
                            Some(links.len() - 1)
                        }
                    }
                    None => {
                        links.push(LinkJson {
                            target,
                            path: None,
                            title: None,
                            relations: Vec::new(),
                        });
                        Some(links.len() - 1)
                    }
                };
                position.insert(target_key, slot);
                slot
            }
        };
        if let (Some(index), Some(name)) = (slot, row_relation) {
            let relations = &mut links[index].relations;
            if !relations.iter().any(|known| known == &name) {
                relations.push(name);
            }
        }
    }

    if let Some(wanted) = relation {
        links.retain(|link| {
            link.relations
                .iter()
                .any(|name| same_relation(name, wanted))
        });
    }

    Ok(links)
}
