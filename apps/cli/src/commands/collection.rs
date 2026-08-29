//! `reflect collection` — a typed tag's collection, from the index (TDR
//! 0005): the notes carrying the tag as database rows, with the property
//! values the tag's schema declares. Requires the index like
//! `search`/`recent` (exit 4 when missing); a tag without a `tag_types` row
//! exits 3 (no type — no collection). Each row's own frontmatter is
//! re-checked on disk so a note flagged private after the last index run
//! never surfaces, and private rows are dropped entirely — property values
//! are frontmatter content.

use std::collections::HashMap;

use reflect_index_schema::{INDEX_FILE, REFLECT_DIR};
use rusqlite::params;

use crate::commands::output::{print_json, CollectionJson, CollectionNoteJson, PropertyJson};
use crate::commands::{still_public_on_disk, warn};
use crate::error::CliError;
use crate::graph::Graph;
use crate::index::{detect_staleness, open_read_only, IndexOpen};

/// One schema entry of `tag_types.schema_json` — the fields the CLI surfaces.
/// Serde mirrors `tagPropertySchema` (`packages/core/src/tags/tag-type.ts`);
/// unknown fields are ignored so a newer app schema still lists.
#[derive(serde::Deserialize)]
struct SchemaProperty {
    name: String,
    key: String,
    #[serde(rename = "type")]
    kind: String,
}

/// The two on-disk forms of `tag_types.schema_json`, mirroring
/// `decodeTagTypeJson`: a bare property array, or `{properties, template}`
/// once the tag carries a new-row template.
#[derive(serde::Deserialize)]
#[serde(untagged)]
enum SchemaJson {
    Properties(Vec<SchemaProperty>),
    Object { properties: Vec<SchemaProperty> },
}

impl SchemaJson {
    fn into_properties(self) -> Vec<SchemaProperty> {
        match self {
            SchemaJson::Properties(properties) => properties,
            SchemaJson::Object { properties } => properties,
        }
    }
}

/// Decode a stored `note_properties` row into a typed JSON value, mirroring
/// `propertyRowValue` (`packages/core/src/indexing/collections.ts`).
fn typed_value(value: &str, value_type: &str, value_number: Option<f64>) -> serde_json::Value {
    match value_type {
        "number" => value_number
            .and_then(serde_json::Number::from_f64)
            .map(serde_json::Value::Number)
            .unwrap_or_else(|| serde_json::Value::String(value.to_string())),
        "boolean" => serde_json::Value::Bool(value == "true"),
        "list" => serde_json::from_str::<serde_json::Value>(value)
            .ok()
            .filter(serde_json::Value::is_array)
            .unwrap_or_else(|| serde_json::Value::String(value.to_string())),
        _ => serde_json::Value::String(value.to_string()),
    }
}

pub fn run(
    graph: &Graph,
    json: bool,
    tag: &str,
    sort: Option<&str>,
    desc: bool,
    limit: usize,
) -> Result<(), CliError> {
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

    let tag_key = crate::keys::fold_tag(tag);
    let schema_json: Option<String> = opened
        .conn
        .query_row(
            "SELECT schema_json FROM tag_types WHERE tag_key = ?1",
            params![tag_key],
            |row| row.get(0),
        )
        .map(Some)
        .or_else(|err| match err {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other),
        })?;
    let Some(schema_json) = schema_json else {
        return Err(CliError::NotFound(format!(
            "#{tag} has no type — configure the tag in Kore to define its collection"
        )));
    };
    // Tolerant like the app: a mangled column reads as an empty schema, and
    // the rows still list. Both stored forms decode — a templated tag writes
    // the object shape (`decodeTagTypeJson`), not the bare array.
    let schema: Vec<SchemaProperty> = serde_json::from_str::<SchemaJson>(&schema_json)
        .map(SchemaJson::into_properties)
        .unwrap_or_default();

    // Mirrors `listCollection`: missing sort values last regardless of
    // direction, then the numeric key, then the string form, case-insensitive.
    let direction = if desc { "DESC" } else { "ASC" };
    let query = if sort.is_some() {
        format!(
            "SELECT n.path, n.title, n.mtime FROM tags t
             JOIN notes n ON n.path = t.note_path
             LEFT JOIN note_properties sp ON sp.note_path = n.path AND sp.key = ?2
             WHERE t.tag_key = ?1 AND n.kind IN ('note','daily') AND n.is_private = 0
             ORDER BY sp.value IS NULL, sp.value_number {direction},
                      sp.value COLLATE NOCASE {direction}, n.mtime DESC, n.path"
        )
    } else {
        "SELECT n.path, n.title, n.mtime FROM tags t
         JOIN notes n ON n.path = t.note_path
         WHERE t.tag_key = ?1 AND n.kind IN ('note','daily') AND n.is_private = 0
         ORDER BY n.is_pinned DESC, n.mtime DESC, n.path"
            .to_string()
    };
    // The row cursor is walked lazily and abandoned at the limit, so rows
    // past the cap never leave SQLite (the `recent` idiom); the on-disk
    // privacy re-check runs inside the walk, before a row takes a slot.
    let mut statement = opened.conn.prepare(&query)?;
    let query_params: Vec<&str> = match sort {
        Some(key) => vec![tag_key.as_str(), key],
        None => vec![tag_key.as_str()],
    };
    let mut kept: Vec<(String, String)> = Vec::new();
    let rows = statement.query_map(rusqlite::params_from_iter(query_params), |row| {
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
            properties_by_path
                .entry(path)
                .or_default()
                .insert(key, typed_value(&value, &value_type, value_number));
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
