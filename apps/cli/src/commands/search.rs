//! `kore search <query>` — hybrid search over the index, the twin of the
//! in-app chat's `search_notes`: the palette's lexical ranking fused with
//! semantic neighbors (`semantic.rs`) whenever the app has built vectors and
//! the model is on this machine; lexical alone otherwise, with the reason on
//! stderr and in the JSON. `--mode lexical` / `--mode semantic` pick one
//! leg. It requires the index: missing/unusable is exit 4 (the CLI never
//! builds or repairs the index — that's the desktop app's job). A stale index
//! warns and still returns rows.
//!
//! The query speaks the palette's filter grammar (`search_query.rs`):
//! `tag:#type/person path:CRM/ -draft "exact words"` filters and searches
//! exactly as it does in the app. Only filters and no text list the
//! matching notes newest first, like the palette. A `links:` /
//! `linked-from:` target that resolves to nothing matches nothing; a
//! private one is refused, like every other surface.

use std::collections::HashSet;

use rusqlite::OptionalExtension;

use crate::commands::output::{print_json, HitJson, SearchJson};
use crate::commands::{require_index, still_public_on_disk, warn};
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
use crate::semantic::{fuse, Semantic};

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

/// Which legs `search` runs (`--mode`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
pub enum SearchMode {
    /// Lexical fused with semantic when semantic is available (the default,
    /// and the in-app chat's `search_notes`).
    Hybrid,
    Lexical,
    /// Meaning only; an error when semantic search is unavailable.
    Semantic,
}

impl SearchMode {
    fn name(self) -> &'static str {
        match self {
            Self::Hybrid => "hybrid",
            Self::Lexical => "lexical",
            Self::Semantic => "semantic",
        }
    }
}

/// The lexical leg: the palette's ranking under the query's filters.
fn lexical_hits(
    conn: &rusqlite::Connection,
    parsed: &crate::search_query::ParsedSearchQuery,
    resolved: &ResolvedFilters,
    limit: usize,
) -> Result<Vec<SearchHit>, CliError> {
    let filters = &parsed.filters;
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
            conn,
            &match_expr,
            body_match_expr.as_deref().unwrap_or(&match_expr),
            &fold_key(&title_text),
            resolved,
            limit,
        ),
        None if parsed.filtered => recall_filtered(conn, resolved, limit),
        None => Ok(Vec::new()),
    }
}

/// What the semantic leg embeds: the free text plus any quoted phrases
/// (filters and exclusions constrain, they do not mean).
fn semantic_text(parsed: &crate::search_query::ParsedSearchQuery) -> String {
    std::iter::once(parsed.text.as_str())
        .chain(parsed.filters.phrases.iter().map(String::as_str))
        .filter(|part| !part.trim().is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn run(
    graph: &Graph,
    json: bool,
    query: &str,
    limit: usize,
    mode: SearchMode,
) -> Result<(), CliError> {
    let (opened, staleness) = require_index(&graph.root)?;
    let conn = &opened.conn;
    let parsed = parse_search_query(query);
    let filters = &parsed.filters;

    let links_to = resolve_link_target(graph, conn, filters.links_to.as_deref())?;
    let linked_from = resolve_link_target(graph, conn, filters.linked_from.as_deref())?;
    let (Some(links_to_path), Some(linked_from_path)) = (links_to, linked_from) else {
        // A link target that names no note: nothing can match.
        return print_hits(
            json,
            query,
            mode.name(),
            None,
            staleness.is_stale(),
            Vec::new(),
        );
    };
    let resolved = ResolvedFilters {
        filters,
        links_to_path,
        linked_from_path,
    };

    let lexical = || lexical_hits(conn, &parsed, &resolved, limit);
    let meaning = semantic_text(&parsed);
    // Filters alone (no text) list the matching notes: nothing to embed.
    let (used, unavailable, hits) = if mode == SearchMode::Lexical || meaning.is_empty() {
        (SearchMode::Lexical, None, lexical()?)
    } else {
        match (
            mode,
            semantic_hits(conn, &meaning, &parsed, &resolved, limit),
        ) {
            (SearchMode::Semantic, Ok(near)) => (SearchMode::Semantic, None, near),
            (SearchMode::Semantic, Err(reason)) => {
                return Err(CliError::Runtime(format!(
                    "semantic search is unavailable: {reason}"
                )))
            }
            (_, Ok(near)) => (
                SearchMode::Hybrid,
                None,
                fuse(vec![lexical()?, near], limit),
            ),
            // Hybrid degrades, never breaks: without the semantic leg it
            // serves lexical alone and says why.
            (_, Err(reason)) => {
                warn(format!("{reason}; showing lexical results only"));
                (SearchMode::Lexical, Some(reason), lexical()?)
            }
        }
    };
    let hits: Vec<SearchHit> = hits
        .into_iter()
        .filter(|hit| still_public_on_disk(&graph.root, &hit.path))
        .collect();
    print_hits(
        json,
        query,
        used.name(),
        unavailable.as_deref(),
        staleness.is_stale(),
        hits,
    )
}

/// The semantic leg, nearest first, or why it cannot run. Filters constrain
/// it too: the KNN reaches further and keeps only notes the filters admit.
fn semantic_hits(
    conn: &rusqlite::Connection,
    meaning: &str,
    parsed: &crate::search_query::ParsedSearchQuery,
    resolved: &ResolvedFilters,
    limit: usize,
) -> Result<Vec<SearchHit>, String> {
    let engine = Semantic::open(conn)?;
    let allowed: Option<HashSet<String>> = if parsed.filtered {
        Some(
            recall_filtered(conn, resolved, UNLIMITED)
                .map_err(|err| err.to_string())?
                .into_iter()
                .map(|hit| hit.path)
                .collect(),
        )
    } else {
        None
    };
    engine
        .search(conn, meaning, limit, allowed.as_ref())
        .map_err(|err| format!("semantic search failed: {err}"))
}

/// A `recall_filtered` limit that admits every row (SQLite reads a negative
/// `LIMIT` as none, and this binds as `-1`).
const UNLIMITED: usize = usize::MAX;

fn print_hits(
    json: bool,
    query: &str,
    mode: &str,
    semantic_unavailable: Option<&str>,
    stale: bool,
    hits: Vec<SearchHit>,
) -> Result<(), CliError> {
    if json {
        return print_json(&SearchJson {
            query,
            stale,
            mode,
            semantic_unavailable,
            results: hits
                .into_iter()
                .map(|hit| HitJson {
                    path: hit.path,
                    title: hit.title,
                    snippet: hit.snippet,
                    heading: hit.heading,
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
