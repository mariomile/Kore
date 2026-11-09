//! `kore collection` — a typed tag's collection, from the index (TDR
//! 0005): the notes carrying the tag as database rows, with the property
//! values the tag's schema declares. Requires the index like
//! `search`/`recent` (exit 4 when missing); a tag without a `tag_types` row
//! exits 3 (no type — no collection). Each row's own frontmatter is
//! re-checked on disk so a note flagged private after the last index run
//! never surfaces, and private rows are dropped entirely — property values
//! are frontmatter content.

use std::collections::HashMap;

use crate::commands::output::{print_json, CollectionJson, CollectionNoteJson, PropertyJson};
use crate::commands::{require_index, still_public_on_disk};
use crate::error::CliError;
use crate::frontmatter_values::PropertyValue;
use crate::graph::Graph;
use crate::schema::{load_descendants, load_schema, SchemaProperty};
use crate::search::{tag_match_sql, Binds};

pub fn run(
    graph: &Graph,
    json: bool,
    tag: &str,
    sort: Option<&str>,
    desc: bool,
    limit: usize,
) -> Result<(), CliError> {
    let (opened, staleness) = require_index(&graph.root)?;

    let tag_key = crate::keys::fold_tag(tag);
    // Tolerant like the app: a mangled column reads as an empty schema, and
    // the rows still list. Inherited fields are merged in (Plan 33 B2).
    let Some(resolved) = load_schema(&opened.conn, tag)? else {
        return Err(CliError::NotFound(format!(
            "#{tag} has no type — configure the tag in Kore to define its collection"
        )));
    };
    let schema: Vec<SchemaProperty> = resolved.properties;
    // The notes of tags that build on this one are rows too, like the app's
    // collection (`listCollection` without `ownOnly`), and so are the notes of
    // tags nested under any of them (`#contact/vip`), with the same match
    // `kore search` uses. The descendants come from core's stored pass.
    let mut binds = Binds::default();
    let sort_bind = sort.map(|key| binds.text(key));
    let mut member_keys = vec![tag_key.clone()];
    member_keys.extend(load_descendants(&opened.conn, tag)?);
    let member_clauses = member_keys
        .iter()
        .map(|key| tag_match_sql("t.tag_key", key, &mut binds))
        .collect::<Vec<_>>()
        .join(" OR ");
    let member_filter =
        format!("EXISTS (SELECT 1 FROM tags t WHERE t.note_path = n.path AND ({member_clauses}))");

    // Mirrors `listCollection`: missing sort values last regardless of
    // direction, then the numeric key, then the string form, case-insensitive.
    let direction = if desc { "DESC" } else { "ASC" };
    let query = match &sort_bind {
        Some(sort_key) => format!(
            "SELECT n.path, n.title, n.mtime FROM notes n
             LEFT JOIN note_properties sp ON sp.note_path = n.path AND sp.key = {sort_key}
             WHERE {member_filter} AND n.kind IN ('note','daily') AND n.is_private = 0
             ORDER BY sp.value IS NULL, sp.value_number {direction},
                      sp.value COLLATE NOCASE {direction}, n.mtime DESC, n.path"
        ),
        None => format!(
            "SELECT n.path, n.title, n.mtime FROM notes n
             WHERE {member_filter} AND n.kind IN ('note','daily') AND n.is_private = 0
             ORDER BY n.is_pinned DESC, n.mtime DESC, n.path"
        ),
    };
    // The row cursor is walked lazily and abandoned at the limit, so rows
    // past the cap never leave SQLite (the `recent` idiom); the on-disk
    // privacy re-check runs inside the walk, before a row takes a slot.
    let mut statement = opened.conn.prepare(&query)?;
    let mut kept: Vec<(String, String)> = Vec::new();
    let rows = statement.query_map(rusqlite::params_from_iter(binds.values), |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    for row in rows {
        let (path, title) = row?;
        if !still_public_on_disk(&graph.root, &path) {
            continue;
        }
        if kept.len() >= limit {
            break;
        }
        kept.push((path, title));
    }

    // Property rows only for the kept notes — the list is bounded by the
    // limit, so a parameterized IN is safe here (unlike the app's uncapped
    // table view, which must join instead).
    let mut properties_by_path: HashMap<String, serde_json::Map<String, serde_json::Value>> =
        HashMap::new();
    if !kept.is_empty() {
        let placeholders = vec!["?"; kept.len()].join(", ");
        let mut properties_statement = opened.conn.prepare(&format!(
            "SELECT note_path, key, value, value_type, value_number
             FROM note_properties WHERE note_path IN ({placeholders})"
        ))?;
        let property_rows = properties_statement.query_map(
            rusqlite::params_from_iter(kept.iter().map(|(path, _)| path.as_str())),
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<f64>>(4)?,
                ))
            },
        )?;
        for row in property_rows {
            let (path, key, value, value_type, value_number) = row?;
            properties_by_path.entry(path).or_default().insert(
                key,
                PropertyValue::from_row(&value, &value_type, value_number).to_json(),
            );
        }
    }

    let notes: Vec<CollectionNoteJson> = kept
        .into_iter()
        .map(|(path, title)| {
            let properties = properties_by_path.remove(&path).unwrap_or_default();
            CollectionNoteJson {
                path,
                title,
                properties,
            }
        })
        .collect();

    if json {
        return print_json(&CollectionJson {
            tag,
            stale: staleness.is_stale(),
            schema: schema
                .iter()
                .map(|property| PropertyJson {
                    name: &property.name,
                    key: &property.key,
                    kind: &property.kind,
                })
                .collect(),
            notes,
        });
    }
    for note in &notes {
        let values = schema
            .iter()
            .filter_map(|property| {
                note.properties.get(&property.key).map(|value| {
                    let rendered = match value {
                        serde_json::Value::String(text) => text.clone(),
                        other => other.to_string(),
                    };
                    format!("{}={rendered}", property.key)
                })
            })
            .collect::<Vec<_>>()
            .join("\t");
        if values.is_empty() {
            println!("{}\t{}", note.path, note.title);
        } else {
            println!("{}\t{}\t{}", note.path, note.title, values);
        }
    }
    Ok(())
}
