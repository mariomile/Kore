//! `reflect properties <note>` — a note's frontmatter as typed property
//! values (the `note_properties` typing, read from the file itself so it is
//! never stale), plus aliases, pin state, and the note's tags from the index
//! when one is open. File-only otherwise, like `show`. A private note is
//! refused (exit 3): property values are frontmatter content.

use reflect_note_policy::split_frontmatter;

use crate::commands::output::{print_json, PropertiesJson};
use crate::commands::{open_index_for_resolution, resolve_existing};
use crate::error::CliError;
use crate::frontmatter_values::{extract_properties, is_pinned, properties_json, PropertyValue};
use crate::graph::Graph;
use crate::note_file::read_note;
use crate::schema::note_tags;

pub fn run(graph: &Graph, json: bool, note_arg: &str) -> Result<(), CliError> {
    let index = open_index_for_resolution(&graph.root);
    let rel_path = resolve_existing(&graph.root, note_arg, index.as_ref().map(|open| &open.conn))?;
    let note = read_note(&graph.root, &rel_path)?;
    let split = split_frontmatter(&note.content);
    let properties = extract_properties(split.raw);
    let pinned = is_pinned(split.raw);
    let tags = match &index {
        Some(open) => note_tags(&open.conn, &rel_path)?,
        None => Vec::new(),
    };

    if json {
        return print_json(&PropertiesJson {
            path: &rel_path,
            title: &note.meta.title,
            aliases: &note.meta.aliases,
            pinned,
            tags,
            properties: properties_json(properties.iter().map(|(key, value)| (key, value))),
        });
    }
    for (key, value) in &properties {
        let rendered = match value {
            PropertyValue::String(text) => text.clone(),
            PropertyValue::List(items) => items.join(", "),
            other => other.to_json().to_string(),
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
