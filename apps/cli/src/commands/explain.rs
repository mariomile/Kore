//! `kore explain <note>`: one note's place in the graph in a single call:
//! title, aliases, tags, typed properties, outline, the links it makes and
//! the notes linking to it. What an agent would otherwise assemble from
//! `properties`, `links` and `backlinks` plus a full read. Requires the index
//! (exit 4); a private note is refused (exit 3), and so is every private
//! neighbor, as in `links`/`backlinks`.

use kore_note_policy::split_frontmatter;

use crate::commands::output::{print_json, ExplainJson};
use crate::commands::{backlinks, links, require_index, resolve_existing};
use crate::error::CliError;
use crate::frontmatter_values::{extract_properties, properties_json};
use crate::graph::Graph;
use crate::note_file::read_note;
use crate::paths::date_from_daily_path;
use crate::schema::note_tags;

pub fn run(graph: &Graph, json: bool, note_arg: &str) -> Result<(), CliError> {
    let (opened, staleness) = require_index(&graph.root)?;
    let rel_path = resolve_existing(&graph.root, note_arg, Some(&opened.conn))?;
    let note = read_note(&graph.root, &rel_path)?;
    let split = split_frontmatter(&note.content);
    let properties = extract_properties(split.raw);
    let outline = outline(split.body);
    let tags = note_tags(&opened.conn, &rel_path)?;
    let links = links::collect(&graph.root, &opened.conn, &rel_path)?;
    let backlinks = backlinks::collect(&graph.root, &opened.conn, &rel_path)?;
    let words = split.body.split_whitespace().count();

    if json {
        return print_json(&ExplainJson {
            path: &rel_path,
            date: date_from_daily_path(&rel_path),
            title: &note.meta.title,
            aliases: &note.meta.aliases,
            tags,
            properties: properties_json(properties.iter().map(|(key, value)| (key, value))),
            words,
            outline,
            stale: staleness.is_stale(),
            links,
            backlinks,
        });
    }
    println!("{}\t{rel_path}", note.meta.title);
    if !tags.is_empty() {
        let tags = tags.iter().map(|tag| format!("#{tag}")).collect::<Vec<_>>();
        println!("tags\t{}", tags.join(" "));
    }
    println!("properties\t{}", properties.len());
    println!("words\t{words}");
    for heading in &outline {
        println!("outline\t{heading}");
    }
    for link in &links {
        println!("links\t{}", link.path.as_deref().unwrap_or(&link.target));
    }
    for backlink in &backlinks {
        println!("linked from\t{}", backlink.path);
    }
    Ok(())
}

/// The body's ATX headings as written (`## Plan`), skipping fenced code.
fn outline(body: &str) -> Vec<String> {
    let mut headings = Vec::new();
    let mut fence: Option<&str> = None;
    for line in body.lines() {
        let trimmed = line.trim_start();
        for marker in ["```", "~~~"] {
            if trimmed.starts_with(marker) {
                fence = match fence {
                    Some(open) if open == marker => None,
                    None => Some(marker),
                    other => other,
                };
            }
        }
        if fence.is_some() {
            continue;
        }
        let level = trimmed.bytes().take_while(|byte| *byte == b'#').count();
        if (1..=6).contains(&level) && trimmed[level..].starts_with(' ') {
            headings.push(trimmed.trim_end().to_string());
        }
    }
    headings
}

#[cfg(test)]
mod tests {
    use super::outline;

    #[test]
    fn outline_lists_headings_outside_code_fences() {
        let body = "# Plan\nintro\n```md\n# not a heading\n```\n## Next\n#tag line\n";
        assert_eq!(outline(body), ["# Plan", "## Next"]);
    }
}
