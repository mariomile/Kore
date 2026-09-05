//! `reflect info` — the graph and its index at a glance: root, CLI version,
//! whether the index exists and is usable/fresh, and public note, daily, and
//! tag counts. The one index-backed command that never exits 4: an agent
//! runs it first to learn what the other commands will be able to do.

use reflect_index_schema::{INDEX_FILE, REFLECT_DIR};

use crate::commands::output::{print_json, CountsJson, IndexInfoJson, InfoJson};
use crate::commands::warn;
use crate::error::CliError;
use crate::graph::Graph;
use crate::index::{detect_staleness, open_read_only, IndexOpen};

pub fn run(graph: &Graph, json: bool) -> Result<(), CliError> {
    let (index, counts) = match open_read_only(&graph.root) {
        IndexOpen::Missing => (
            IndexInfoJson {
                present: false,
                usable: false,
                newer_schema: false,
                stale: false,
                stale_files: 0,
            },
            None,
        ),
        IndexOpen::Unusable(message) => {
            warn(&message);
            (
                IndexInfoJson {
                    present: true,
                    usable: false,
                    newer_schema: false,
                    stale: false,
                    stale_files: 0,
                },
                None,
            )
        }
        IndexOpen::Opened(opened) => {
            if opened.newer_schema {
                warn("the index schema is newer than this CLI — update Kore");
            }
            let staleness = detect_staleness(&opened.conn, &graph.root)?;
            let notes: i64 = opened.conn.query_row(
                "SELECT count(*) FROM notes WHERE kind = 'note' AND is_private = 0",
                [],
                |row| row.get(0),
            )?;
            let dailies: i64 = opened.conn.query_row(
                "SELECT count(*) FROM notes WHERE kind = 'daily' AND is_private = 0",
                [],
                |row| row.get(0),
            )?;
            let tags: i64 = opened.conn.query_row(
                "SELECT count(DISTINCT tags.tag_key) FROM tags
                 JOIN notes ON notes.path = tags.note_path
                 WHERE notes.kind IN ('note', 'daily') AND notes.is_private = 0",
                [],
                |row| row.get(0),
            )?;
            (
                IndexInfoJson {
                    present: true,
                    usable: true,
                    newer_schema: opened.newer_schema,
                    stale: staleness.is_stale(),
                    stale_files: staleness.total(),
                },
                Some(CountsJson {
                    notes,
                    dailies,
                    tags,
                }),
            )
        }
    };

    if json {
        return print_json(&InfoJson {
            root: graph.root.display().to_string(),
            cli_version: env!("CARGO_PKG_VERSION"),
            index,
            counts,
        });
    }
    println!("root\t{}", graph.root.display());
    println!("cli\t{}", env!("CARGO_PKG_VERSION"));
    let index_state = if !index.present {
        format!("missing ({REFLECT_DIR}/{INDEX_FILE}) — open the graph in Kore to build it")
    } else if !index.usable {
        "unusable".to_string()
    } else if index.stale {
        format!("stale ({} file(s) differ)", index.stale_files)
    } else {
        "fresh".to_string()
    };
    println!("index\t{index_state}");
    if let Some(counts) = counts {
        println!("notes\t{}", counts.notes);
        println!("dailies\t{}", counts.dailies);
        println!("tags\t{}", counts.tags);
    }
    Ok(())
}
