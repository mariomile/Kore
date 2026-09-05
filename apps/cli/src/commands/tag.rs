//! `reflect tag <note> <tag>` / `reflect untag <note> <tag>` — the inline
//! tag is the note's membership in a collection (TDR 0005, "the hashtag is
//! the supertag"), so `tag` appends `#tag` as a trailing body line exactly
//! like the app's bulk-tag action (`appendBodyTag`), stamping the type's
//! `created` properties for a typed tag, and `untag` removes only such a
//! standalone trailing line — a tag inside prose is the user's text and is
//! refused, never edited. Both are idempotent and refuse private notes.

use std::fs;

use crate::body_tag::{append_body_tag, is_tag_name, remove_trailing_tag, Untag};
use crate::commands::output::{print_json, TagWriteJson, UntagJson};
use crate::commands::properties::property_json;
use crate::commands::{open_index_for_resolution, resolve_existing};
use crate::error::CliError;
use crate::frontmatter_values::extract_properties;
use crate::frontmatter_write::{patch_source, Patch};
use crate::graph::Graph;
use crate::schema::load_schema;
use crate::write::atomic_write;
use reflect_note_policy::split_frontmatter;

fn tag_name(arg: &str) -> Result<&str, CliError> {
    let tag = arg.trim().trim_start_matches('#');
    if !is_tag_name(tag) {
        return Err(CliError::Usage(format!(
            "'{arg}' is not a tag name (a letter, then letters, digits, /, _ or -)"
        )));
    }
    Ok(tag)
}

pub fn run_tag(graph: &Graph, json: bool, note_arg: &str, tag_arg: &str) -> Result<(), CliError> {
    let tag = tag_name(tag_arg)?;
    let index = open_index_for_resolution(&graph.root);
    let rel_path = resolve_existing(&graph.root, note_arg, index.as_ref().map(|open| &open.conn))?;
    let absolute = graph.root.join(&rel_path);
    let source = fs::read_to_string(&absolute)
        .map_err(|err| CliError::Runtime(format!("could not read {rel_path}: {err}")))?;

    let (tagged, added) = match append_body_tag(&source, tag) {
        Some(tagged) => (tagged, true),
        None => (source.clone(), false),
    };

    // A typed tag's `created` stamps, like a row born in the app — only for
    // keys the note does not already carry, so re-tagging never rewrites a
    // history the note already has.
    let mut stamped = serde_json::Map::new();
    let mut patch: Patch = Vec::new();
    if let Some(open) = &index {
        if let Some(schema) = load_schema(&open.conn, tag)? {
            let existing = extract_properties(split_frontmatter(&tagged).raw);
            for (key, value) in schema.created_stamps() {
                if existing.iter().any(|(present, _)| *present == key) {
                    continue;
                }
                stamped.insert(key.clone(), property_json(&value));
                patch.push((key, Some(value)));
            }
        }
    }
    let next = patch_source(&tagged, &patch)?;
    if next != source {
        atomic_write(&absolute, &next)?;
    }

    if json {
        return print_json(&TagWriteJson {
            path: &rel_path,
            tag,
            added,
            stamped,
        });
    }
    println!("{}", absolute.display());
    Ok(())
}

pub fn run_untag(graph: &Graph, json: bool, note_arg: &str, tag_arg: &str) -> Result<(), CliError> {
    let tag = tag_name(tag_arg)?;
    let index = open_index_for_resolution(&graph.root);
    let rel_path = resolve_existing(&graph.root, note_arg, index.as_ref().map(|open| &open.conn))?;
    let absolute = graph.root.join(&rel_path);
    let source = fs::read_to_string(&absolute)
        .map_err(|err| CliError::Runtime(format!("could not read {rel_path}: {err}")))?;

    let removed = match remove_trailing_tag(&source, tag) {
        Untag::Removed(next) => {
            atomic_write(&absolute, &next)?;
            true
        }
        Untag::Absent => false,
        Untag::Inline => {
            return Err(CliError::Runtime(format!(
                "#{tag} sits inline in the body of {rel_path} — edit the note to remove it"
            )))
        }
    };

    if json {
        return print_json(&UntagJson {
            path: &rel_path,
            tag,
            removed,
        });
    }
    println!("{}", absolute.display());
    Ok(())
}
