//! `reflect properties <note>` — a note's frontmatter as typed property
//! values (the `note_properties` typing, read from the file itself so it is
//! never stale), plus aliases, pin state, and the note's tags from the index
//! when one is open. File-only otherwise, like `show`. A private note is
//! refused (exit 3): property values are frontmatter content.

use reflect_note_policy::split_frontmatter;

use crate::commands::open_index_for_resolution;
use crate::commands::output::{print_json, PropertiesJson};
use crate::error::CliError;
use crate::frontmatter_values::{extract_properties, is_pinned, PropertyValue};
use crate::graph::Graph;
use crate::note_file::read_note;
use crate::resolve::{resolve_note, ResolvedNote};

/// A property value as JSON (numbers stay numbers, lists stay lists).
pub fn property_json(value: &PropertyValue) -> serde_json::Value {
    match value {
        PropertyValue::String(text) => serde_json::Value::String(text.clone()),
        // Integral values print as integers (`4`, not `4.0`), the JSON an
        // agent expects and the form the YAML carried.
        PropertyValue::Number(number) if number.fract() == 0.0 && number.abs() < 1e15 => {
            serde_json::Value::from(*number as i64)
        }
        PropertyValue::Number(number) => serde_json::Number::from_f64(*number)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),
        PropertyValue::Bool(flag) => serde_json::Value::Bool(*flag),
        PropertyValue::List(items) => serde_json::Value::Array(
            items
                .iter()
                .map(|item| serde_json::Value::String(item.clone()))
                .collect(),
        ),
    }
}

/// The tags the index knows for `rel_path`, display-cased, one per key.
pub fn indexed_tags(conn: &rusqlite::Connection, rel_path: &str) -> Result<Vec<String>, CliError> {
    let mut statement = conn.prepare(
        "SELECT min(tag) FROM tags WHERE note_path = ?1 GROUP BY tag_key ORDER BY tag_key",
    )?;
    let tags = statement
        .query_map([rel_path], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(tags)
}

pub fn run(graph: &Graph, json: bool, note_arg: &str) -> Result<(), CliError> {
    let index = open_index_for_resolution(&graph.root);
    let resolved = resolve_note(note_arg, &graph.root, index.as_ref().map(|open| &open.conn))?;
    if let ResolvedNote::Daily { date, rel_path } = &resolved {
        if !graph.root.join(rel_path).is_file() {
            return Err(CliError::NotFound(format!(
                "no daily note for {date} ({rel_path})"
            )));
        }
    }
    let rel_path = resolved.rel_path();
    let note = read_note(&graph.root, rel_path)?;
    let split = split_frontmatter(&note.content);
    let properties = extract_properties(split.raw);
    let pinned = is_pinned(split.raw);
    let tags = match &index {
        Some(open) => indexed_tags(&open.conn, rel_path)?,
        None => Vec::new(),
    };

    if json {
        let mut map = serde_json::Map::new();
        for (key, value) in &properties {
            map.insert(key.clone(), property_json(value));
        }
        return print_json(&PropertiesJson {
            path: rel_path,
            title: &note.meta.title,
            aliases: &note.meta.aliases,
            pinned,
            tags,
            properties: map,
        });
    }
    for (key, value) in &properties {
        let rendered = match value {
            PropertyValue::String(text) => text.clone(),
            PropertyValue::List(items) => items.join(", "),
            other => property_json(other).to_string(),
        };
        println!("{key}\t{rendered}");
    }
    if !tags.is_empty() {
        let tags = tags
            .iter()
            .map(|tag| format!("#{tag}"))
            .collect::<Vec<_>>()
            .join(" ");
        println!("tags\t{tags}");
    }
    Ok(())
}
