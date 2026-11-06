//! `kore grep <text>`: every line that contains an exact text, across every
//! note on disk, with its line number. For what ranked search would cut off
//! at its top results: every open task naming a person, every mention of an
//! amount. Works without an index (it walks the files). Private notes and
//! iCloud placeholders are skipped, since neither can be read safely.

use crate::commands::output::{print_json, GrepJson, GrepMatchJson};
use crate::error::CliError;
use crate::graph::Graph;
use crate::note_file::{read_note, walk_notes};

pub fn run(
    graph: &Graph,
    json: bool,
    text: &str,
    ignore_case: bool,
    limit: usize,
) -> Result<(), CliError> {
    if text.is_empty() {
        return Err(CliError::Usage("the text to find is empty".to_string()));
    }
    let needle = if ignore_case {
        text.to_lowercase()
    } else {
        text.to_string()
    };

    let mut notes = walk_notes(&graph.root);
    notes.retain(|note| !note.placeholder);
    notes.sort_by(|left, right| left.rel_path.cmp(&right.rel_path));

    let mut matches: Vec<GrepMatchJson> = Vec::new();
    let mut truncated = false;
    'notes: for disk_note in notes {
        let Ok(note) = read_note(&graph.root, &disk_note.rel_path) else {
            continue;
        };
        for (index, line) in note.content.lines().enumerate() {
            let found = if ignore_case {
                line.to_lowercase().contains(&needle)
            } else {
                line.contains(&needle)
            };
            if !found {
                continue;
            }
            if matches.len() == limit {
                truncated = true;
                break 'notes;
            }
            matches.push(GrepMatchJson {
                path: disk_note.rel_path.clone(),
                title: note.meta.title.clone(),
                line: index + 1,
                text: line.to_string(),
            });
        }
    }

    if json {
        return print_json(&GrepJson {
            text,
            truncated,
            matches,
        });
    }
    for found in &matches {
        println!("{}:{}:{}", found.path, found.line, found.text);
    }
    if truncated {
        crate::commands::warn(format!("stopped at {limit} matches; raise --limit"));
    }
    Ok(())
}
