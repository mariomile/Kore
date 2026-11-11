//! `kore guide` — what an agent needs before it touches the graph: the
//! vault's own agent contract and a map of where the notes are.
//!
//! The contract is a plain file at the graph root: `AGENTS.md` (the name
//! Codex, Cursor and most agent runtimes read on their own), else
//! `CLAUDE.md`. It is the user's file and the single source of the rules —
//! an agent that clones the vault's git repo reads it directly, and one that
//! connects through `kore mcp` gets the same text from here, so both paths
//! follow identical rules. The privacy contract holds: a contract marked
//! `private: true` is not served.
//!
//! The map is computed from the files on every call (no index needed, so it
//! is never stale): the top-level folders with their note counts, their
//! largest subfolders, and where daily notes go.
//!
//! `--init` writes a starter `AGENTS.md` (plus a `CLAUDE.md` that imports
//! it, for Claude Code) when the graph has none. It never overwrites.

use std::collections::BTreeMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;

use serde::Serialize;

use crate::commands::output::print_json;
use crate::error::CliError;
use crate::graph::Graph;
use crate::note_file::{read_note, walk_notes};
use crate::paths::daily_path;

/// Contract file names, in the order they are looked up.
pub const CONTRACT_FILES: [&str; 2] = ["AGENTS.md", "CLAUDE.md"];

/// Contract text beyond this is cut (and flagged): a contract is a boot file,
/// and a client injects it whole into every session.
const CONTRACT_MAX_CHARS: usize = 20_000;

/// Largest subfolders listed under each top-level folder.
const SUBFOLDERS_SHOWN: usize = 8;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuideJson {
    /// Null when the graph has no (public) contract file.
    pub contract: Option<ContractJson>,
    pub map: MapJson,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContractJson {
    pub path: String,
    pub text: String,
    pub truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapJson {
    /// Every public note in the graph. Private notes are left out of every
    /// count, so a folder holding only private notes does not appear.
    pub notes: usize,
    /// Notes directly at the root.
    pub root_notes: usize,
    /// Where a daily note goes, with the date spelled `YYYY-MM-DD`.
    pub daily_pattern: String,
    pub folders: Vec<FolderJson>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderJson {
    pub path: String,
    /// Notes anywhere under this folder.
    pub notes: usize,
    /// The largest subfolders, most notes first.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub folders: Vec<FolderJson>,
}

/// The first contract file that exists and is public, cut to the cap.
fn read_contract(root: &Path) -> Option<ContractJson> {
    CONTRACT_FILES.iter().find_map(|name| {
        if !root.join(name).is_file() {
            return None;
        }
        // A private contract is withheld, and does not fall through to the
        // next name: the user hid the rules on purpose.
        let note = read_note(root, name).ok();
        Some(note.map(|note| {
            let text = note.content.trim().to_string();
            let truncated = text.chars().count() > CONTRACT_MAX_CHARS;
            ContractJson {
                path: (*name).to_string(),
                text: if truncated {
                    text.chars().take(CONTRACT_MAX_CHARS).collect()
                } else {
                    text
                },
                truncated,
            }
        }))
    })?
}

/// Note counts per top-level folder and per second-level folder.
pub fn vault_map(root: &Path) -> MapJson {
    // The privacy contract holds for the map too: a private note is
    // invisible, so neither its folder nor its count may surface. iCloud
    // placeholders fail closed, as everywhere else (their privacy can't be
    // read from disk).
    let notes: Vec<_> = walk_notes(root)
        .into_iter()
        .filter(|note| !note.placeholder && read_note(root, &note.rel_path).is_ok())
        .collect();
    let mut root_notes = 0;
    let mut top: BTreeMap<String, (usize, BTreeMap<String, usize>)> = BTreeMap::new();
    for note in &notes {
        let parts: Vec<&str> = note.rel_path.split('/').collect();
        if parts.len() == 1 {
            root_notes += 1;
            continue;
        }
        let entry = top.entry(parts[0].to_string()).or_default();
        entry.0 += 1;
        if parts.len() > 2 {
            *entry
                .1
                .entry(format!("{}/{}", parts[0], parts[1]))
                .or_default() += 1;
        }
    }
    let folders = top
        .into_iter()
        .map(|(path, (count, subfolders))| {
            let mut subfolders: Vec<FolderJson> = subfolders
                .into_iter()
                .map(|(path, notes)| FolderJson {
                    path,
                    notes,
                    folders: Vec::new(),
                })
                .collect();
            // Most notes first; the stable sort keeps ties alphabetical.
            subfolders.sort_by_key(|sub| std::cmp::Reverse(sub.notes));
            subfolders.truncate(SUBFOLDERS_SHOWN);
            FolderJson {
                path,
                notes: count,
                folders: subfolders,
            }
        })
        .collect();
    MapJson {
        notes: notes.len(),
        root_notes,
        daily_pattern: daily_path("YYYY-MM-DD"),
        folders,
    }
}

/// The map as Markdown lines, shared by the text output and the starter
/// contract.
fn map_lines(map: &MapJson) -> Vec<String> {
    let mut lines = Vec::new();
    for folder in &map.folders {
        let mut line = format!("- `{}/`: {} notes", folder.path, folder.notes);
        if !folder.folders.is_empty() {
            let subs: Vec<String> = folder
                .folders
                .iter()
                .map(|sub| {
                    let name = sub.path.rsplit('/').next().unwrap_or(&sub.path);
                    format!("{name} {}", sub.notes)
                })
                .collect();
            line.push_str(&format!(" ({})", subs.join(", ")));
        }
        lines.push(line);
    }
    if map.root_notes > 0 {
        lines.push(format!("- root: {} notes", map.root_notes));
    }
    lines.push(format!("- Daily notes: `{}`", map.daily_pattern));
    lines
}

/// The starter contract `--init` writes: Kore's own conventions (the memory
/// files the in-app agents keep) plus the map at the time of writing.
fn starter_contract(map: &MapJson) -> String {
    let mut text = String::from(
        "# Agent contract\n\
\n\
This folder is a Kore vault: plain Markdown notes with [[wiki links]], #tags and \
frontmatter properties. These rules apply to every agent that works here, whether \
it reads the files directly (a git clone, Claude Code, Codex) or through `kore mcp`. \
The user's request in the conversation wins over this file; this file wins over an \
agent's own memory. Edit it freely: it is the user's file, and Kore never rewrites it.\n\
\n\
## Boot\n\
\n\
1. Read this file.\n\
2. Read `agents/user.md` (who the user is) and `agents/memory/facts.md` (shared facts \
and decisions) when they exist.\n\
3. Search before you write: updating an existing note beats creating a new one.\n\
\n\
## Rules\n\
\n\
- A note with `private: true` or `sensitivity: private` in its frontmatter is off limits: never read, quote or \
send it anywhere.\n\
- Never delete or rewrite the user's own text. Append, link, or ask first.\n\
- Link related notes with [[wiki links]] and reuse existing #tags.\n\
- Don't invent facts, numbers, paths or project status.\n\
- Never write secrets or credentials into a note.\n\
\n\
## Memory: where things go\n\
\n\
| What you learned | Where it goes |\n\
|---|---|\n\
| About the user: preferences, how they work | `agents/user.md` |\n\
| A fact or decision every agent should know | `agents/memory/facts.md`, one line per fact with its source and date |\n\
| A repeatable procedure | `agents/skills/<slug>.md` |\n\
| Anything about a specific topic, person or project | that topic's note; create it if none exists |\n\
| What you did in a session that changed notes | one short entry appended to `agents/memory/log.md` |\n\
\n\
## Map\n\
\n\
Where the notes were when this file was written (`kore guide` prints the current map):\n\
\n",
    );
    for line in map_lines(map) {
        text.push_str(&line);
        text.push('\n');
    }
    text
}

/// What Claude Code reads at the root: a one-line import of the contract.
const CLAUDE_ADAPTER: &str = "# CLAUDE.md\n\nFollow the vault's agent contract:\n\n@AGENTS.md\n";

/// Create `name` with `contents` unless it exists. True when written.
fn create_if_absent(root: &Path, name: &str, contents: &str) -> Result<bool, CliError> {
    match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(root.join(name))
    {
        Ok(mut file) => {
            file.write_all(contents.as_bytes())
                .map_err(|err| CliError::Runtime(format!("could not write {name}: {err}")))?;
            Ok(true)
        }
        Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => Ok(false),
        Err(err) => Err(CliError::Runtime(format!("could not create {name}: {err}"))),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InitJson {
    /// The files written; empty when the graph already had both.
    written: Vec<&'static str>,
}

fn init(graph: &Graph, json: bool) -> Result<(), CliError> {
    let mut written = Vec::new();
    let has_contract = CONTRACT_FILES
        .iter()
        .any(|name| graph.root.join(name).exists());
    if !has_contract {
        let map = vault_map(&graph.root);
        if create_if_absent(&graph.root, "AGENTS.md", &starter_contract(&map))? {
            written.push("AGENTS.md");
        }
    }
    // Claude Code reads CLAUDE.md, not AGENTS.md: give it the import, but
    // only when AGENTS.md is the contract and CLAUDE.md is free.
    if graph.root.join("AGENTS.md").is_file()
        && create_if_absent(&graph.root, "CLAUDE.md", CLAUDE_ADAPTER)?
    {
        written.push("CLAUDE.md");
    }
    if json {
        return print_json(&InitJson { written });
    }
    if written.is_empty() {
        println!("The vault already has an agent contract; nothing written.");
    } else {
        for name in written {
            println!("wrote\t{name}");
        }
    }
    Ok(())
}

pub fn run(graph: &Graph, json: bool, write_init: bool) -> Result<(), CliError> {
    if write_init {
        return init(graph, json);
    }
    let guide = GuideJson {
        contract: read_contract(&graph.root),
        map: vault_map(&graph.root),
    };
    if json {
        return print_json(&guide);
    }
    match &guide.contract {
        Some(contract) => {
            println!("# Agent contract ({})\n", contract.path);
            println!("{}", contract.text);
            if contract.truncated {
                println!("\n[cut at {CONTRACT_MAX_CHARS} characters: read {} for the rest]", contract.path);
            }
        }
        None => println!(
            "# No agent contract\n\nThis vault has no AGENTS.md. `kore guide --init` writes a starter one."
        ),
    }
    println!("\n# Map ({} notes)\n", guide.map.notes);
    for line in map_lines(&guide.map) {
        println!("{line}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn graph_with(files: &[(&str, &str)]) -> (tempfile::TempDir, Graph) {
        let dir = tempfile::tempdir().expect("tempdir");
        for (path, content) in files {
            let absolute = dir.path().join(path);
            fs::create_dir_all(absolute.parent().unwrap()).unwrap();
            fs::write(absolute, content).unwrap();
        }
        let graph = Graph {
            root: dir.path().to_path_buf(),
        };
        (dir, graph)
    }

    #[test]
    fn serves_the_contract_and_counts_folders() {
        let (_dir, graph) = graph_with(&[
            (
                "AGENTS.md",
                "# Rules\n\nWrite decisions in Memory/decisions.\n",
            ),
            ("CLAUDE.md", "@AGENTS.md\n"),
            ("CRM/People/ada.md", "# Ada\n"),
            ("CRM/People/bob.md", "# Bob\n"),
            ("CRM/Companies/acme.md", "# Acme\n"),
            ("CRM/index.md", "# CRM\n"),
            ("Journal/secret.md", "---\nprivate: true\n---\n# Secret\n"),
        ]);
        let contract = read_contract(&graph.root).expect("contract");
        assert_eq!(contract.path, "AGENTS.md");
        assert!(contract.text.contains("Memory/decisions"));
        let map = vault_map(&graph.root);
        assert_eq!(map.notes, 6, "the private note is not counted");
        assert_eq!(map.root_notes, 2);
        assert_eq!(map.folders[0].path, "CRM");
        assert_eq!(map.folders[0].notes, 4);
        assert_eq!(map.folders[0].folders[0].path, "CRM/People");
        assert_eq!(map.folders[0].folders[0].notes, 2);
        assert_eq!(map.folders.len(), 1, "a private-only folder is not named");
        assert_eq!(map.daily_pattern, "daily/YYYY-MM-DD.md");
    }

    #[test]
    fn a_private_contract_is_withheld_and_init_never_overwrites() {
        let (_dir, graph) = graph_with(&[("AGENTS.md", "---\nprivate: true\n---\n# Mine\n")]);
        assert!(read_contract(&graph.root).is_none());
        init(&graph, true).unwrap();
        let agents = fs::read_to_string(graph.root.join("AGENTS.md")).unwrap();
        assert!(agents.contains("# Mine"));
        // AGENTS.md is the contract, so Claude Code still gets the import.
        assert!(fs::read_to_string(graph.root.join("CLAUDE.md"))
            .unwrap()
            .contains("@AGENTS.md"));
    }

    #[test]
    fn init_writes_a_starter_contract_with_the_map() {
        let (_dir, graph) = graph_with(&[("notes/idea.md", "# Idea\n")]);
        init(&graph, true).unwrap();
        let agents = fs::read_to_string(graph.root.join("AGENTS.md")).unwrap();
        assert!(agents.contains("## Memory: where things go"));
        assert!(agents.contains("- `notes/`: 1 notes"));
        assert!(read_contract(&graph.root).is_some());
    }
}
