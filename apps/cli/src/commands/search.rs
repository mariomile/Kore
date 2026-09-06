//! `reflect search <query>` — ranked lexical search over the FTS index. The
//! one command that requires the index: missing/unusable is exit 4 (the CLI
//! never builds or repairs the index — that's the desktop app's job). A stale
//! index warns and still returns rows.

use crate::commands::output::{print_json, HitJson, SearchJson};
use crate::commands::{require_index, still_public_on_disk};
use crate::error::CliError;
use crate::graph::Graph;
use crate::keys::fold_key;
use crate::search::{build_fts_match, search_index, SearchHit};

pub fn run(graph: &Graph, json: bool, query: &str, limit: usize) -> Result<(), CliError> {
    let (opened, staleness) = require_index(&graph.root)?;

    let hits: Vec<SearchHit> = match build_fts_match(query) {
        Some(match_expr) => search_index(&opened.conn, &match_expr, &fold_key(query), limit)?,
        None => Vec::new(),
    };
    let hits: Vec<SearchHit> = hits
        .into_iter()
        .filter(|hit| still_public_on_disk(&graph.root, &hit.path))
        .collect();

    if json {
        return print_json(&SearchJson {
            query,
            stale: staleness.is_stale(),
            results: hits
                .into_iter()
                .map(|hit| HitJson {
                    path: hit.path,
                    title: hit.title,
                    snippet: hit.snippet,
                    score: hit.score,
                })
                .collect(),
        });
    }
    for hit in &hits {
        println!("{}\t{}", hit.path, hit.title);
        if !hit.snippet.is_empty() {
            println!("    {}", hit.snippet.replace('\n', " "));
        }
    }
    Ok(())
}
