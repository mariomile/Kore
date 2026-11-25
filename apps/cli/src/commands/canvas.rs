//! `kore canvas <folder>`: draw a folder as a JSON Canvas board
//! (<https://jsoncanvas.org>, the `.canvas` format Obsidian and Kore open).
//! The folder's own notes come first as a grid of note cards; each
//! subfolder follows as a labelled group holding its notes (recursively);
//! a wiki link between two notes on the board becomes an arrow. The layout
//! is deterministic (path order), so a regenerated board lands the same.
//!
//! The file is written atomically next to the folder's notes as
//! `<folder>/<Folder name>.canvas` (or `--out`), and an existing file is
//! never replaced without `--force`: once someone has arranged a board by
//! hand it is theirs. Requires the index for link resolution (exit 4).
//! Private notes are neither drawn nor linked.

use std::collections::{BTreeMap, HashSet};
use std::path::Path;

use serde::Serialize;
use serde_json::{json, Value};

use crate::commands::output::print_json;
use crate::commands::require_index;
use crate::error::CliError;
use crate::graph::Graph;
use crate::note_file::{read_note, walk_notes};
use crate::write::{atomic_create, atomic_write, CreateError};

/// Default cap on the notes one board draws: past it a canvas stops being
/// readable, and the command says what it left out.
pub const DEFAULT_LIMIT: usize = 120;

/// A note card's size and the grid around it, in canvas units.
const CARD_WIDTH: i64 = 400;
const CARD_HEIGHT: i64 = 280;
const GAP: i64 = 40;
const COLUMNS: usize = 4;
/// The space between groups, and a group's inner padding (its label sits above).
const GROUP_GAP: i64 = 120;
const GROUP_PADDING: i64 = 40;

#[derive(Serialize)]
struct CanvasJson<'a> {
    path: &'a str,
    notes: usize,
    groups: usize,
    edges: usize,
    /// Notes left off the board by `--limit`.
    #[serde(skip_serializing_if = "is_zero")]
    omitted: usize,
}

fn is_zero(value: &usize) -> bool {
    *value == 0
}

pub struct Options<'a> {
    pub out: Option<&'a str>,
    pub force: bool,
    pub limit: usize,
}

pub fn run(graph: &Graph, json: bool, folder: &str, options: Options) -> Result<(), CliError> {
    let folder = folder.trim().trim_matches('/');
    if folder.is_empty() || escapes(folder) {
        return Err(CliError::Usage("name a folder of the graph".into()));
    }
    if !graph.root.join(folder).is_dir() {
        return Err(CliError::NotFound(format!(
            "no folder {folder} in the graph"
        )));
    }
    let (opened, _staleness) = require_index(&graph.root)?;

    let prefix = format!("{folder}/");
    let mut paths: Vec<String> = walk_notes(&graph.root)
        .into_iter()
        .filter(|note| !note.placeholder && note.rel_path.starts_with(&prefix))
        .map(|note| note.rel_path)
        .filter(|path| read_note(&graph.root, path).is_ok())
        .collect();
    paths.sort();
    let omitted = paths.len().saturating_sub(options.limit);
    paths.truncate(options.limit);
    if paths.is_empty() {
        return Err(CliError::NotFound(format!("no notes in {folder}")));
    }

    let sections = sections(&prefix, &paths);
    let on_board: HashSet<&str> = paths.iter().map(String::as_str).collect();
    let mut edges = Vec::new();
    for path in &paths {
        let links = crate::commands::links::collect(&graph.root, &opened.conn, path, None)?;
        let mut seen = HashSet::new();
        for target in links.into_iter().filter_map(|link| link.path) {
            if target != *path && on_board.contains(target.as_str()) && seen.insert(target.clone())
            {
                edges.push(edge(path, &target));
            }
        }
    }
    let (nodes, groups) = layout(&sections);

    let rel_out = match options.out {
        Some(out) => out.trim_matches('/').to_string(),
        None => format!("{prefix}{}.canvas", folder_name(folder)),
    };
    if !rel_out.ends_with(".canvas") || escapes(&rel_out) {
        return Err(CliError::Usage(
            "--out must name a .canvas file inside the graph".into(),
        ));
    }
    let document = json!({ "nodes": nodes, "edges": edges });
    let contents = serde_json::to_string_pretty(&document)
        .map_err(|err| CliError::runtime(err.to_string()))?
        + "\n";
    let target = graph.root.join(&rel_out);
    write(&target, &rel_out, &contents, options.force)?;

    if json {
        return print_json(&CanvasJson {
            path: &rel_out,
            notes: paths.len(),
            groups,
            edges: edges.len(),
            omitted,
        });
    }
    println!("{rel_out}");
    if omitted > 0 {
        crate::commands::warn(format!(
            "{omitted} note(s) left off the board (raise --limit to draw them)"
        ));
    }
    Ok(())
}

fn write(target: &Path, rel_out: &str, contents: &str, force: bool) -> Result<(), CliError> {
    if force {
        return atomic_write(target, contents);
    }
    atomic_create(target, contents).map_err(|err| match err {
        CreateError::Exists => CliError::Usage(format!(
            "{rel_out} already exists — pass --force to replace it, or --out another file"
        )),
        CreateError::Other(err) => CliError::runtime(err.to_string()),
    })
}

/// A graph-relative path that climbs out of the graph.
fn escapes(path: &str) -> bool {
    path.split('/').any(|segment| segment == "..")
}

/// The folder's last segment: the board's file name and its root label.
fn folder_name(folder: &str) -> &str {
    folder.rsplit('/').next().unwrap_or(folder)
}

/// The notes split into the folder's own (`None`) and one section per
/// direct subfolder, each in path order.
fn sections<'a>(prefix: &str, paths: &'a [String]) -> Vec<(Option<&'a str>, Vec<&'a str>)> {
    let mut own = Vec::new();
    let mut nested: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for path in paths {
        let rest = &path[prefix.len()..];
        match rest.split_once('/') {
            Some((sub, _)) => nested.entry(sub).or_default().push(path),
            None => own.push(path.as_str()),
        }
    }
    let mut out = Vec::new();
    if !own.is_empty() {
        out.push((None, own));
    }
    out.extend(nested.into_iter().map(|(sub, notes)| (Some(sub), notes)));
    out
}

/// Cards on a grid, sections stacked top to bottom; a subfolder's cards sit
/// inside a group node drawn behind them (JSON Canvas draws in array order).
fn layout(sections: &[(Option<&str>, Vec<&str>)]) -> (Vec<Value>, usize) {
    let mut nodes = Vec::new();
    let mut groups = 0;
    let mut top = 0;
    for (label, notes) in sections {
        let inset = if label.is_some() { GROUP_PADDING } else { 0 };
        let columns = COLUMNS.min(notes.len()) as i64;
        let rows = notes.len().div_ceil(COLUMNS) as i64;
        if let Some(label) = label {
            groups += 1;
            nodes.push(json!({
                "id": node_id("group", label),
                "type": "group",
                "label": label,
                "x": 0,
                "y": top,
                "width": columns * (CARD_WIDTH + GAP) - GAP + 2 * GROUP_PADDING,
                "height": rows * (CARD_HEIGHT + GAP) - GAP + 2 * GROUP_PADDING,
            }));
        }
        for (index, path) in notes.iter().enumerate() {
            let column = (index % COLUMNS) as i64;
            let row = (index / COLUMNS) as i64;
            nodes.push(json!({
                "id": node_id("note", path),
                "type": "file",
                "file": path,
                "x": inset + column * (CARD_WIDTH + GAP),
                "y": top + inset + row * (CARD_HEIGHT + GAP),
                "width": CARD_WIDTH,
                "height": CARD_HEIGHT,
            }));
        }
        top += rows * (CARD_HEIGHT + GAP) - GAP + 2 * inset + GROUP_GAP;
    }
    (nodes, groups)
}

fn edge(from: &str, to: &str) -> Value {
    json!({
        "id": node_id("link", &format!("{from}\n{to}")),
        "fromNode": node_id("note", from),
        "toNode": node_id("note", to),
    })
}

/// A stable 16-hex-digit id (the length Obsidian writes) from the node's
/// kind and key, so regenerating a board keeps its ids.
fn node_id(kind: &str, key: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(format!("{kind}\0{key}").as_bytes());
    digest[..8]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sections_put_own_notes_first_then_one_per_subfolder() {
        let paths: Vec<String> = [
            "Projects/a.md",
            "Projects/Studio/b.md",
            "Projects/Studio/deep/c.md",
            "Projects/Zeta/d.md",
        ]
        .map(String::from)
        .to_vec();
        let sections = sections("Projects/", &paths);
        assert_eq!(
            sections,
            vec![
                (None, vec!["Projects/a.md"]),
                (
                    Some("Studio"),
                    vec!["Projects/Studio/b.md", "Projects/Studio/deep/c.md"]
                ),
                (Some("Zeta"), vec!["Projects/Zeta/d.md"]),
            ]
        );
    }

    #[test]
    fn a_group_wraps_its_cards_and_sections_never_overlap() {
        let sections = vec![
            (None, vec!["a.md"]),
            (Some("Sub"), vec!["Sub/b.md", "Sub/c.md"]),
        ];
        let (nodes, groups) = layout(&sections);
        assert_eq!(groups, 1);
        let group = nodes.iter().find(|node| node["type"] == "group").unwrap();
        let (gx, gy) = (group["x"].as_i64().unwrap(), group["y"].as_i64().unwrap());
        let (gw, gh) = (
            group["width"].as_i64().unwrap(),
            group["height"].as_i64().unwrap(),
        );
        // The group starts below the first section's card.
        assert!(gy >= CARD_HEIGHT + GAP);
        for card in nodes.iter().filter(|node| {
            node["file"]
                .as_str()
                .is_some_and(|file| file.starts_with("Sub/"))
        }) {
            let (x, y) = (card["x"].as_i64().unwrap(), card["y"].as_i64().unwrap());
            assert!(x >= gx && y >= gy);
            assert!(x + CARD_WIDTH <= gx + gw && y + CARD_HEIGHT <= gy + gh);
        }
    }

    #[test]
    fn ids_are_stable_and_obsidian_length() {
        assert_eq!(node_id("note", "a.md"), node_id("note", "a.md"));
        assert_ne!(node_id("note", "a.md"), node_id("note", "b.md"));
        assert_eq!(node_id("note", "a.md").len(), 16);
    }
}
