//! `reflect set <note> key=value… [--unset key]…` — write frontmatter
//! property values the way the app's property editors do: typed by the
//! schemas of the tags the note carries (union, first declaration wins),
//! plain text for keys no schema declares, reserved keys refused, view-only
//! types refused. The block is spliced key by key and verified before the
//! atomic write; the body is never touched. A private note is refused.

use crate::commands::output::{print_json, SetJson};
use crate::commands::{open_index_for_resolution, resolve_existing};
use crate::error::CliError;
use crate::frontmatter_values::properties_json;
use crate::frontmatter_write::{patch_source, Patch};
use crate::graph::Graph;
use crate::schema::{
    is_property_key, parse_assignments, schema_for_note, warn_untyped_writes, TagSchema,
};
use crate::write::update_note;

pub fn run(
    graph: &Graph,
    json: bool,
    note_arg: &str,
    assignments: &[String],
    unset: &[String],
) -> Result<(), CliError> {
    if assignments.is_empty() && unset.is_empty() {
        return Err(CliError::Usage(
            "nothing to set — give key=value pairs and/or --unset keys".to_string(),
        ));
    }
    for key in unset {
        if !is_property_key(key) {
            return Err(CliError::Usage(format!(
                "'{key}' is not a writable property key"
            )));
        }
        if assignments.iter().any(|assignment| {
            assignment
                .split_once('=')
                .is_some_and(|(set, _)| set.trim() == key)
        }) {
            return Err(CliError::Usage(format!(
                "'{key}' is both set and --unset — pick one"
            )));
        }
    }

    let index = open_index_for_resolution(&graph.root);
    let rel_path = resolve_existing(&graph.root, note_arg, index.as_ref().map(|open| &open.conn))?;
    let schema = match &index {
        Some(open) => schema_for_note(&open.conn, &rel_path)?,
        None => {
            if !assignments.is_empty() {
                warn_untyped_writes();
            }
            TagSchema::default()
        }
    };
    let values = parse_assignments(&schema, assignments)?;

    let mut patch: Patch = values
        .iter()
        .map(|(key, value)| (key.clone(), Some(value.clone())))
        .collect();
    patch.extend(unset.iter().map(|key| (key.clone(), None)));
    update_note(&graph.root, &rel_path, |source| {
        patch_source(source, &patch)
    })?;

    let absolute = graph.root.join(&rel_path);
    if json {
        return print_json(&SetJson {
            path: &rel_path,
            absolute_path: absolute.display().to_string(),
            set: properties_json(values.iter().map(|(key, value)| (key, value))),
            unset,
        });
    }
    println!("{}", absolute.display());
    Ok(())
}
