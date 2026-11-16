//! `kore coverage <question>`: what the vault holds on a question *before*
//! an agent answers it, so the agent can say "the vault does not cover X"
//! instead of filling the gap from its own guesses.
//!
//! Deterministic and local, no model involved: the question is split into
//! content words (stopwords and short words dropped), each word is counted
//! against the index's full-text table, and the notes matching the most
//! words are returned with their types, dates and the relations around
//! them. `verdict` sums it up: `covered` (every word is in the vault and the
//! best notes hold most of them), `partial` (some words are missing, listed
//! in `missing`), `none` (nothing matches). Private notes are never counted
//! or returned. Requires the index (exit 4).

use std::collections::{BTreeMap, BTreeSet, HashSet};

use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;

use crate::commands::output::print_json;
use crate::commands::{require_index, still_public_on_disk};
use crate::error::CliError;
use crate::graph::Graph;
use crate::link_context::{links_have_relation, relation_column};
use crate::schema::note_tags;

pub const DEFAULT_LIMIT: usize = 10;
pub const MAX_LIMIT: usize = 50;
/// More words than this and the question is a paragraph, not a question.
const MAX_TERMS: usize = 12;
/// How many bm25 matches are re-ranked by the number of words they hold.
const CANDIDATES: usize = 300;
/// The longest run of words tried as a note title ("Product Discovery Sprint").
const MAX_ENTITY_WORDS: usize = 4;

/// Words that carry no topic, in the two languages the vaults are written in.
const STOPWORDS: &[&str] = &[
    // English
    "the", "and", "for", "are", "was", "were", "what", "who", "whom", "which", "when", "where",
    "why", "how", "does", "did", "has", "have", "had", "with", "about", "from", "this", "that",
    "these", "those", "there", "their", "they", "them", "you", "your", "our", "can", "could",
    "should", "would", "will", "into", "any", "all", "not", "but", "its", "his", "her", "she",
    "him", "out", "than", "then", "also", "some", "more", "most", "much", "many", "between",
    "tell", "know", "show", "list", "give", // Italian
    "che", "chi", "cosa", "come", "quando", "dove", "perché", "perche", "quale", "quali", "quanto",
    "quanti", "una", "uno", "gli", "le", "dei", "degli", "delle", "del", "della", "dello", "nel",
    "nella", "nelle", "negli", "nei", "con", "per", "tra", "fra", "sul", "sulla", "sui", "sono",
    "sei", "siamo", "hanno", "abbiamo", "ho", "hai", "era", "erano", "stato", "stata", "questo",
    "questa", "questi", "queste", "quello", "quella", "quelli", "anche", "non", "più", "piu",
    "suo", "sua", "suoi", "sue", "mio", "mia", "miei", "mie", "loro", "dal", "dalla", "dai",
    "dalle", "alla", "alle", "agli", "allo", "ai", "sulle", "sugli", "fatto", "dimmi", "dammi",
    "sai", "cosa", "c'è", "ce",
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TermJson {
    term: String,
    /// Public notes containing the word (prefix match, like search).
    notes: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CoverageNoteJson {
    path: String,
    title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    date: Option<String>,
    /// The question's words this note contains.
    matched: Vec<String>,
    tags: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EntityJson {
    path: String,
    title: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CountJson {
    name: String,
    count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CoverageJson<'a> {
    question: &'a str,
    /// `covered`, `partial` or `none`.
    verdict: &'static str,
    /// Always `lexical` for now: words, not meaning.
    mode: &'static str,
    stale: bool,
    terms: Vec<TermJson>,
    /// The question's words no public note contains.
    missing: Vec<String>,
    /// Notes the question names by title or alias ("Company 7", "Ada").
    entities: Vec<EntityJson>,
    notes: Vec<CoverageNoteJson>,
    /// Tags across the returned notes, most common first.
    types: Vec<CountJson>,
    /// Named relations on links from or to the returned notes.
    relations: Vec<CountJson>,
    /// The span of the returned notes: daily dates, else last-edit dates.
    #[serde(skip_serializing_if = "Option::is_none")]
    earliest: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    latest: Option<String>,
}

pub fn run(graph: &Graph, json: bool, question: &str, limit: usize) -> Result<(), CliError> {
    if limit == 0 || limit > MAX_LIMIT {
        return Err(CliError::Usage(format!(
            "--limit must be between 1 and {MAX_LIMIT}"
        )));
    }
    let words = content_terms(question);
    if words.is_empty() {
        return Err(CliError::Usage(
            "the question has no content words to look for".to_string(),
        ));
    }
    let (opened, staleness) = require_index(&graph.root)?;
    let conn = &opened.conn;

    let mut terms = Vec::new();
    let mut term_sets: Vec<(String, HashSet<String>)> = Vec::new();
    for word in &words {
        let paths = term_paths(conn, word)?;
        terms.push(TermJson {
            term: word.clone(),
            notes: paths.len() as i64,
        });
        if !paths.is_empty() {
            term_sets.push((word.clone(), paths));
        }
    }
    let missing: Vec<String> = terms
        .iter()
        .filter(|term| term.notes == 0)
        .map(|term| term.term.clone())
        .collect();
    let present: Vec<&str> = term_sets.iter().map(|(word, _)| word.as_str()).collect();
    let mut entities: Vec<EntityJson> = Vec::new();
    for (path, title) in named_entities(conn, question)? {
        if still_public_on_disk(&graph.root, &path) {
            entities.push(EntityJson { path, title });
        }
    }

    // Candidates: every note an entity names, then the best bm25 matches of
    // any word. Ranked by entity first, then how many of the question's
    // words the note holds, then bm25.
    let mut candidates: Vec<(String, String, Option<String>)> = Vec::new();
    for entity in &entities {
        candidates.push(note_row(conn, &entity.path)?);
    }
    if !present.is_empty() {
        candidates.extend(best_notes(conn, &present, CANDIDATES)?);
    }
    let entity_paths: HashSet<&str> = entities.iter().map(|e| e.path.as_str()).collect();
    let mut seen: HashSet<String> = HashSet::new();
    let mut scored: Vec<(bool, usize, usize, CoverageNoteJson)> = Vec::new();
    for (order, (path, title, date)) in candidates.into_iter().enumerate() {
        if !seen.insert(path.clone()) {
            continue;
        }
        let matched: Vec<String> = term_sets
            .iter()
            .filter(|(_, paths)| paths.contains(&path))
            .map(|(word, _)| word.clone())
            .collect();
        let is_entity = entity_paths.contains(path.as_str());
        scored.push((
            is_entity,
            matched.len(),
            order,
            CoverageNoteJson {
                tags: Vec::new(),
                path,
                title,
                date,
                matched,
            },
        ));
    }
    scored.sort_by(|left, right| {
        right
            .0
            .cmp(&left.0)
            .then(right.1.cmp(&left.1))
            .then(left.2.cmp(&right.2))
    });
    let mut notes = Vec::new();
    for (_, _, _, mut note) in scored {
        if notes.len() == limit {
            break;
        }
        if !still_public_on_disk(&graph.root, &note.path) {
            continue;
        }
        note.tags = note_tags(conn, &note.path)?;
        notes.push(note);
    }

    let verdict = verdict(words.len(), missing.len(), !entities.is_empty(), &notes);
    let types = count_names(notes.iter().flat_map(|note| note.tags.iter().cloned()));
    let relations = count_names(note_relations(conn, &notes)?.into_iter());
    let dates: BTreeSet<&str> = notes
        .iter()
        .filter_map(|note| note.date.as_deref())
        .collect();
    let earliest = dates.first().map(|date| date.to_string());
    let latest = dates.last().map(|date| date.to_string());

    if json {
        return print_json(&CoverageJson {
            question,
            verdict,
            mode: "lexical",
            stale: staleness.is_stale(),
            terms,
            missing,
            entities,
            notes,
            types,
            relations,
            earliest,
            latest,
        });
    }
    println!("{verdict}");
    if !missing.is_empty() {
        println!("missing\t{}", missing.join(" "));
    }
    for note in &notes {
        println!("{}\t{}\t{}", note.path, note.title, note.matched.join(" "));
    }
    Ok(())
}

/// The question's content words: lowercased, punctuation trimmed, stopwords
/// and one- or two-letter words dropped (numbers kept), first-seen order,
/// at most [`MAX_TERMS`].
fn content_terms(question: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut terms = Vec::new();
    for raw in question.split(|c: char| c.is_whitespace() || c == '/' || c == ',') {
        let word = raw
            .trim_matches(|c: char| !c.is_alphanumeric())
            .to_lowercase();
        let has_digit = word.chars().any(|c| c.is_ascii_digit());
        if word.is_empty() || (word.chars().count() < 3 && !has_digit) {
            continue;
        }
        if STOPWORDS.contains(&word.as_str()) || !crate::search::is_tokenizable(&word) {
            continue;
        }
        if seen.insert(word.clone()) {
            terms.push(word);
        }
        if terms.len() == MAX_TERMS {
            break;
        }
    }
    terms
}

/// One word as an FTS5 literal: quoted, embedded quotes doubled, matched
/// as a prefix (`pric` finds `pricing`) unless it is a number, so `7` does
/// not match `73`.
fn fts_literal(word: &str) -> String {
    let quoted = format!("\"{}\"", word.replace('"', "\"\""));
    if word.chars().all(|c| c.is_ascii_digit()) {
        quoted
    } else {
        format!("{quoted}*")
    }
}

const PUBLIC_NOTE: &str = "notes.is_private = 0 AND notes.kind != 'template'";

/// The public notes containing `word`.
fn term_paths(conn: &Connection, word: &str) -> Result<HashSet<String>, CliError> {
    let mut statement = conn.prepare_cached(&format!(
        "SELECT DISTINCT notes.path
         FROM search_fts JOIN notes ON notes.path = search_fts.path
         WHERE search_fts MATCH ?1 AND {PUBLIC_NOTE}"
    ))?;
    let rows = statement.query_map([fts_literal(word)], |row| row.get::<_, String>(0))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn note_row(conn: &Connection, path: &str) -> Result<(String, String, Option<String>), CliError> {
    Ok(conn.query_row(
        "SELECT path, title, coalesce(daily_date, date(updated_at / 1000, 'unixepoch'))
         FROM notes WHERE path = ?1",
        [path],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?)
}

/// Public notes the question names by title or alias: runs of up to
/// [`MAX_ENTITY_WORDS`] words looked up as note keys, longest first, a run
/// inside a longer match skipped. A lone stopword or short word is no name.
fn named_entities(conn: &Connection, question: &str) -> Result<Vec<(String, String)>, CliError> {
    let words: Vec<String> = question
        .split_whitespace()
        .map(|raw| raw.trim_matches(|c: char| !c.is_alphanumeric()).to_string())
        .filter(|word| !word.is_empty())
        .collect();
    let mut statement = conn.prepare_cached(&format!(
        "SELECT notes.path, notes.title FROM note_keys k
         JOIN notes ON notes.path = k.note_path
         WHERE k.key = ?1 AND {PUBLIC_NOTE}
         ORDER BY notes.path LIMIT 1"
    ))?;
    let mut covered = vec![false; words.len()];
    let mut found: Vec<(String, String)> = Vec::new();
    for size in (1..=MAX_ENTITY_WORDS.min(words.len())).rev() {
        for start in 0..=words.len() - size {
            if covered[start..start + size].iter().any(|&taken| taken) {
                continue;
            }
            let run = words[start..start + size].join(" ");
            let lower = run.to_lowercase();
            if size == 1 && (lower.chars().count() < 3 || STOPWORDS.contains(&lower.as_str())) {
                continue;
            }
            let key = crate::keys::fold_key(&run);
            let hit = statement
                .query_row([&key], |row| Ok((row.get(0)?, row.get(1)?)))
                .optional()?;
            if let Some(hit) = hit {
                covered[start..start + size]
                    .iter_mut()
                    .for_each(|taken| *taken = true);
                if !found.iter().any(|(path, _)| *path == hit.0) {
                    found.push(hit);
                }
            }
        }
    }
    Ok(found)
}

/// The public notes matching any of the words, best bm25 first.
fn best_notes(
    conn: &Connection,
    words: &[&str],
    limit: usize,
) -> Result<Vec<(String, String, Option<String>)>, CliError> {
    let expr = words
        .iter()
        .map(|word| fts_literal(word))
        .collect::<Vec<_>>()
        .join(" OR ");
    let mut statement = conn.prepare(&format!(
        "SELECT notes.path, notes.title,
                coalesce(notes.daily_date, date(notes.updated_at / 1000, 'unixepoch'))
         FROM search_fts JOIN notes ON notes.path = search_fts.path
         WHERE search_fts MATCH ?1 AND {PUBLIC_NOTE}
         ORDER BY bm25(search_fts, 0, 10.0, 1.0)
         LIMIT ?2"
    ))?;
    let rows = statement.query_map(rusqlite::params![expr, limit as i64], |row| {
        Ok((row.get(0)?, row.get(1)?, row.get(2)?))
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// The relation names on links leaving or reaching the returned notes.
fn note_relations(conn: &Connection, notes: &[CoverageNoteJson]) -> Result<Vec<String>, CliError> {
    if notes.is_empty() || !links_have_relation(conn) {
        return Ok(Vec::new());
    }
    let relation = relation_column(true, "b");
    let mut statement = conn.prepare_cached(&format!(
        "SELECT {relation} FROM backlinks b
         WHERE (b.source_path = ?1 OR b.target_path = ?1) AND {relation} IS NOT NULL"
    ))?;
    let mut names = Vec::new();
    for note in notes {
        let rows = statement.query_map([&note.path], |row| row.get::<_, String>(0))?;
        for row in rows {
            names.push(row?);
        }
    }
    Ok(names)
}

fn count_names(names: impl Iterator<Item = String>) -> Vec<CountJson> {
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    for name in names {
        *counts.entry(name).or_default() += 1;
    }
    let mut counted: Vec<CountJson> = counts
        .into_iter()
        .map(|(name, count)| CountJson { name, count })
        .collect();
    counted.sort_by_key(|counted| std::cmp::Reverse(counted.count));
    counted.truncate(10);
    counted
}

/// `none` when nothing matches; `covered` when every word is in the vault
/// and either the question names a note or the best note holds at least half
/// of the words; `partial` otherwise.
fn verdict(words: usize, missing: usize, named: bool, notes: &[CoverageNoteJson]) -> &'static str {
    let best = notes
        .iter()
        .map(|note| note.matched.len())
        .max()
        .unwrap_or(0);
    if best == 0 && !named {
        "none"
    } else if missing == 0 && (named || best * 2 >= words) {
        "covered"
    } else {
        "partial"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_content_words_in_both_languages() {
        assert_eq!(
            content_terms("Chi lavora in DeepAgent e su che progetti, nel 2026?"),
            vec!["lavora", "deepagent", "progetti", "2026"]
        );
        assert_eq!(
            content_terms("What did Ada say about pricing?"),
            vec!["ada", "say", "pricing"]
        );
        assert!(content_terms("e di che?").is_empty());
    }

    fn note(matched: &[&str]) -> CoverageNoteJson {
        CoverageNoteJson {
            path: String::new(),
            title: String::new(),
            date: None,
            matched: matched.iter().map(|word| word.to_string()).collect(),
            tags: Vec::new(),
        }
    }

    #[test]
    fn verdict_reads_missing_words_and_how_much_one_note_holds() {
        assert_eq!(verdict(2, 2, false, &[]), "none");
        assert_eq!(verdict(2, 0, false, &[note(&["a", "b"])]), "covered");
        assert_eq!(verdict(3, 1, false, &[note(&["a", "b"])]), "partial");
        assert_eq!(
            verdict(4, 0, false, &[note(&["a"]), note(&["b"])]),
            "partial"
        );
        assert_eq!(verdict(4, 0, true, &[note(&["a"])]), "covered");
    }
}
