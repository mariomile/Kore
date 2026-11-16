//! `kore backlinks <note>` — the notes linking *to* a note, read from the
//! index's `backlinks` view (the same resolution the app's Backlinks panel
//! uses: ranked wiki-name joins with exact-file-first fallback, templates
//! excluded). Requires the index like `search`/`tasks` (exit 4 when
//! missing). A private target is refused like every other surface, and each
//! source note's own frontmatter is re-checked on disk before it surfaces.
//! Each backlink names its relations (`company: "[[Acme]]"` on a person is a
//! `company` backlink of Acme) and carries the words around each link, read
//! from the source file, so an agent can quote where the link came from.
//! `--relation` keeps only the notes linking under that key.

use std::path::Path;

use crate::commands::output::{
    print_json, BacklinkJson, BacklinksJson, LinkMentionJson, BACKLINK_MENTIONS_MAX,
};
use crate::commands::require_index;
use crate::error::CliError;
use crate::graph::Graph;
use crate::link_context::{context_at, links_have_relation, relation_column, same_relation};
use crate::note_file::{ensure_not_private, parse_note_meta, read_note};
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

    let backlinks = collect(&graph.root, &opened.conn, &rel_path, relation)?;

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
        let mut line = format!("{}\t{}", backlink.path, backlink.title);
        if !backlink.relations.is_empty() {
            line.push_str(&format!("\t({})", backlink.relations.join(", ")));
        }
        if backlink.count > 1 {
            line.push_str(&format!("\t({} links)", backlink.count));
        }
        println!("{line}");
    }
    Ok(())
}

/// The public notes linking to `rel_path`, one row per source with its link
/// count, relations and the context of its first links. With `relation`, only
/// the sources linking under that frontmatter key, and only those links as
/// mentions. The caller has already refused a private target.
pub(crate) fn collect(
    root: &Path,
    conn: &rusqlite::Connection,
    rel_path: &str,
    relation: Option<&str>,
) -> Result<Vec<BacklinkJson>, CliError> {
    let relation_sql = relation_column(links_have_relation(conn), "backlinks");
    let mut statement = conn.prepare(&format!(
        "SELECT backlinks.source_path, notes.title, {relation_sql},
                backlinks.pos_from, backlinks.pos_to
         FROM backlinks JOIN notes ON notes.path = backlinks.source_path
         WHERE backlinks.target_path = ?1 AND backlinks.source_path != ?1
         ORDER BY backlinks.source_path, backlinks.pos_from"
    ))?;
    let rows = statement.query_map([rel_path], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, i64>(4)?,
        ))
    })?;

    // Rows arrive grouped by source. Each source file is read once: the read
    // re-checks it is still public on disk and gives the context text.
    let mut backlinks: Vec<BacklinkJson> = Vec::new();
    let mut current: Option<(String, Option<String>)> = None;
    for row in rows {
        let (path, title, row_relation, pos_from, pos_to) = row?;
        if let Some(wanted) = relation {
            if !row_relation
                .as_deref()
                .is_some_and(|name| same_relation(name, wanted))
            {
                continue;
            }
        }
        if current.as_ref().map(|(known, _)| known) != Some(&path) {
            // A source that is gone or private on disk yields no content and
            // is skipped entirely.
            let content = read_note(root, &path).ok().map(|note| note.content);
            if content.is_some() {
                backlinks.push(BacklinkJson {
                    path: path.clone(),
                    title,
                    count: 0,
                    relations: Vec::new(),
                    mentions: Vec::new(),
                });
            }
            current = Some((path.clone(), content));
        }
        let Some((_, Some(content))) = current.as_ref() else {
            continue;
        };
        let Some(entry) = backlinks.last_mut() else {
            continue;
        };
        entry.count += 1;
        if let Some(name) = &row_relation {
            if !entry.relations.iter().any(|known| known == name) {
                entry.relations.push(name.clone());
            }
        }
        if entry.mentions.len() < BACKLINK_MENTIONS_MAX {
            let context = context_at(content, pos_from, pos_to);
            if !entry.mentions.iter().any(|known| known.context == context) {
                entry.mentions.push(LinkMentionJson {
                    relation: row_relation,
                    context,
                });
            }
        }
    }
    Ok(backlinks)
}
