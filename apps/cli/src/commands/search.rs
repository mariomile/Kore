//! `kore search <query>` — ranked lexical search over the FTS index. The
//! one command that requires the index: missing/unusable is exit 4 (the CLI
//! never builds or repairs the index — that's the desktop app's job). A stale
//! index warns and still returns rows.
//!
//! The query speaks the palette's filter grammar (`search_query.rs`):
//! `tag:#type/person path:CRM/ -draft "exact words"` filters and searches
//! exactly as it does in the app. Only filters and no text list the
//! matching notes newest first, like the palette. A `links:` /
//! `linked-from:` target that resolves to nothing matches nothing; a
//! private one is refused, like every other surface.

use rusqlite::OptionalExtension;

use crate::commands::output::{print_json, HitJson, SearchJson};
use crate::commands::{require_index, still_public_on_disk};
use crate::error::CliError;
use crate::graph::Graph;
use crate::keys::fold_key;
use crate::note_file::ensure_not_private;
use crate::resolve::resolve_note;
use crate::search::{
    build_body_fts_match, build_body_phrase_fts_match, build_fts_match, build_phrase_fts_match,
    join_fts, recall_filtered, search_index, ResolvedFilters, SearchHit,
};
use crate::search_query::parse_search_query;

/// A `links:` / `linked-from:` target as a graph path: `Ok(None)` when it
/// names no note (the filter then matches nothing), refused when private.
/// The palette's `resolveWikiTarget` answers first — the ranked `note_keys`
/// claim for the folded target, so a date finds the daily (wherever the
/// vault keeps it) or a note titled with that date, exactly as `[[links]]`
/// do. Only a miss falls back to `show`'s resolution, which adds explicit
/// graph paths and notes the index has not caught up with.
fn resolve_link_target(
    graph: &Graph,
    conn: &rusqlite::Connection,
    target: Option<&str>,
) -> Result<Option<Option<String>>, CliError> {
    let Some(target) = target else {
        return Ok(Some(None));
    };
    let key = fold_key(target);
    let claimed: Option<String> = conn
        .query_row(
            "SELECT note_path FROM note_keys WHERE key = ?1 LIMIT 1",
            [&key],
            |row| row.get(0),
        )
        .optional()?;
    let rel_path = match claimed {
        Some(rel_path) => rel_path,
        None => match resolve_note(target, &graph.root, Some(conn)) {
            Ok(resolved) => resolved.rel_path().to_string(),
            Err(CliError::NotFound(_)) => return Ok(None),
            Err(error) => return Err(error),
        },
    };
    ensure_not_private(&graph.root, &rel_path)?;
    Ok(Some(Some(rel_path)))
}

pub fn run(graph: &Graph, json: bool, query: &str, limit: usize) -> Result<(), CliError> {
    let (opened, staleness) = require_index(&graph.root)?;
    let parsed = parse_search_query(query);
    let filters = &parsed.filters;

    let links_to = resolve_link_target(graph, &opened.conn, filters.links_to.as_deref())?;
    let linked_from = resolve_link_target(graph, &opened.conn, filters.linked_from.as_deref())?;
    let hits: Vec<SearchHit> = match (links_to, linked_from) {
        (Some(links_to_path), Some(linked_from_path)) => {
            let resolved = ResolvedFilters {
                filters,
                links_to_path,
                linked_from_path,
            };
            // Phrases rank like typed words; the phrase predicate is what
            // guarantees every hit contains them.
            let match_expr = join_fts(
                &[
                    build_fts_match(&parsed.text),
                    build_phrase_fts_match(&filters.phrases),
                ],
                "AND",
            );
            let body_match_expr = join_fts(
                &[
                    build_body_fts_match(&parsed.text),
                    build_body_phrase_fts_match(&filters.phrases),
                ],
                "OR",
            );
            // A phrase-only query ranks titles by its phrases.
            let title_text = if parsed.text.is_empty() {
                filters.phrases.join(" ")
            } else {
                parsed.text.clone()
            };
            match match_expr {
                Some(match_expr) => search_index(
                    &opened.conn,
                    &match_expr,
                    body_match_expr.as_deref().unwrap_or(&match_expr),
                    &fold_key(&title_text),
                    &resolved,
                    limit,
                )?,
                None if parsed.filtered => recall_filtered(&opened.conn, &resolved, limit)?,
                None => Vec::new(),
            }
        }
        // A link target that names no note: nothing can match.
        _ => Vec::new(),
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
