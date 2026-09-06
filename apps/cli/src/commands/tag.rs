//! `reflect tag <note> <tag>` / `reflect untag <note> <tag>` — the inline
//! tag is the note's membership in a collection (TDR 0005, "the hashtag is
//! the supertag"), so `tag` appends `#tag` as a trailing body line exactly
//! like the app's bulk-tag action (`appendBodyTag`), stamping the type's
//! `created` properties for a typed tag, and `untag` removes only such a
//! standalone trailing line — a tag inside prose is the user's text and is
//! refused, never edited. Both are idempotent and refuse private notes.

use reflect_note_policy::split_frontmatter;

use crate::body_tag::{append_body_tag, is_tag_name, remove_trailing_tag, Untag};
use crate::commands::output::{print_json, TagWriteJson, UntagJson};
use crate::commands::{open_index_for_resolution, resolve_existing};
use crate::error::CliError;
use crate::frontmatter_values::{extract_properties, properties_json, PropertyValue};
use crate::frontmatter_write::{patch_source, Patch};
use crate::graph::Graph;
use crate::schema::{load_schema, TagSchema};
use crate::write::update_note;

fn tag_name(arg: &str) -> Result<&str, CliError> {
    let tag = arg.trim().trim_start_matches('#');
    if !is_tag_name(tag) {
        return Err(CliError::Usage(format!(
            "'{arg}' is not a tag name (a letter, then letters, digits, /, _ or -)"
        )));
    }
    Ok(tag)
}

/// A typed tag's `created` stamps, like a row born in the app — only for
/// keys the note does not already carry, so re-tagging never rewrites a
/// history the note already has.
fn missing_stamps(schema: Option<&TagSchema>, source: &str) -> Vec<(String, PropertyValue)> {
    let Some(schema) = schema else {
        return Vec::new();
    };
    let existing = extract_properties(split_frontmatter(source).raw);
    schema
        .created_stamps()
        .into_iter()
        .filter(|(key, _)| !existing.iter().any(|(present, _)| present == key))
        .collect()
}

pub fn run_tag(graph: &Graph, json: bool, note_arg: &str, tag_arg: &str) -> Result<(), CliError> {
    let tag = tag_name(tag_arg)?;
    let index = open_index_for_resolution(&graph.root);
    let rel_path = resolve_existing(&graph.root, note_arg, index.as_ref().map(|open| &open.conn))?;
    let schema = match &index {
        Some(open) => load_schema(&open.conn, tag)?,
        None => None,
    };

    let mut added = false;
    let mut stamped: Vec<(String, PropertyValue)> = Vec::new();
    update_note(&graph.root, &rel_path, |source| {
        let tagged = match append_body_tag(source, tag) {
            Some(tagged) => {
                added = true;
                tagged
            }
            None => source.to_string(),
        };
        stamped = missing_stamps(schema.as_ref(), &tagged);
        let patch: Patch = stamped
            .iter()
            .map(|(key, value)| (key.clone(), Some(value.clone())))
            .collect();
        patch_source(&tagged, &patch)
    })?;

    if json {
        return print_json(&TagWriteJson {
            path: &rel_path,
            tag,
            added,
            stamped: properties_json(stamped.iter().map(|(key, value)| (key, value))),
        });
    }
    println!("{}", graph.root.join(&rel_path).display());
    Ok(())
}

pub fn run_untag(graph: &Graph, json: bool, note_arg: &str, tag_arg: &str) -> Result<(), CliError> {
    let tag = tag_name(tag_arg)?;
    let index = open_index_for_resolution(&graph.root);
    let rel_path = resolve_existing(&graph.root, note_arg, index.as_ref().map(|open| &open.conn))?;

    let removed = update_note(&graph.root, &rel_path, |source| {
        match remove_trailing_tag(source, tag) {
            Untag::Removed(next) => Ok(next),
            Untag::Absent => Ok(source.to_string()),
            Untag::Inline => Err(CliError::Runtime(format!(
                "#{tag} sits inline in the body of {rel_path} — edit the note to remove it"
            ))),
        }
    })?;

    if json {
        return print_json(&UntagJson {
            path: &rel_path,
            tag,
            removed,
        });
    }
    println!("{}", graph.root.join(&rel_path).display());
    Ok(())
}
