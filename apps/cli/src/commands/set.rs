//! `reflect set <note> key=value… [--unset key]…` — write frontmatter
//! property values the way the app's property editors do: typed by the
//! schemas of the tags the note carries (union, first declaration wins),
//! plain text for keys no schema declares, reserved keys refused, view-only
//! types refused. The block is spliced key by key and verified before the
//! atomic write; the body is never touched. A private note is refused.

use std::fs;

use crate::commands::output::{print_json, SetJson};
use crate::commands::properties::{indexed_tags, property_json};
use crate::commands::{open_index_for_resolution, resolve_existing, warn};
use crate::error::CliError;
use crate::frontmatter_write::{patch_source, Patch};
use crate::graph::Graph;
use crate::schema::{is_property_key, parse_assignments, union_schema, TagSchema};
use crate::write::atomic_write;

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
    }

    let index = open_index_for_resolution(&graph.root);
    let rel_path = resolve_existing(&graph.root, note_arg, index.as_ref().map(|open| &open.conn))?;
    let schema = match &index {
        Some(open) => union_schema(&open.conn, &indexed_tags(&open.conn, &rel_path)?)?,
        None => {
            if !assignments.is_empty() {
                warn("no index — values are written as text (open the graph in Kore to type them)");
            }
            TagSchema::default()
        }
    };
    let values = parse_assignments(&schema, assignments)?;

    let absolute = graph.root.join(&rel_path);
    let source = fs::read_to_string(&absolute)
        .map_err(|err| CliError::Runtime(format!("could not read {rel_path}: {err}")))?;
    let mut patch: Patch = values
        .iter()
        .map(|(key, value)| (key.clone(), Some(value.clone())))
        .collect();
    patch.extend(unset.iter().map(|key| (key.clone(), None)));
    let patched = patch_source(&source, &patch)?;
    if patched != source {
        atomic_write(&absolute, &patched)?;
    }

    if json {
        let mut set = serde_json::Map::new();
        for (key, value) in &values {
            set.insert(key.clone(), property_json(value));
        }
        return print_json(&SetJson {
            path: &rel_path,
            absolute_path: absolute.display().to_string(),
            set,
            unset,
        });
    }
    println!("{}", absolute.display());
    Ok(())
}
