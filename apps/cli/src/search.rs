//! Lexical search over the FTS index. The `MATCH` expression is built exactly
//! like `buildFtsMatch` (`packages/core/src/indexing/search-query.ts`) and
//! ranking matches the desktop's palette search (`filtered-search.ts`): exact,
//! prefix, and all-terms title matches lead, then title-boosted bm25 with the
//! same column weights, pinned, recency, and `path`. Folded title recall
//! matches each term at a title word start — except terms in unsegmented
//! scripts, which match anywhere: FTS5's `unicode61` tokenizer cannot match
//! part of an uninterrupted CJK title (`titleRecallNeedles` in
//! `search-query.ts` is the TS twin). The CLI adds its privacy filter
//! (`notes.is_private = 0`) and FTS5 `snippet()`.

use std::collections::HashMap;

use rusqlite::types::Value;
use rusqlite::{params_from_iter, Connection};
use unicode_normalization::char::is_combining_mark;

use crate::error::CliError;
use crate::keys::{contains_unsegmented_script, fold_graph_path};
use crate::search_query::{PropertyFilter, SearchFilters};

const HIGHLIGHT_START: char = '\u{1}';
const HIGHLIGHT_END: char = '\u{2}';

/// Enclosed alphanumerics (`Ⓐ`, `🅰`): general category `So`, which `unicode61`
/// separates on, but which `char::is_alphanumeric` accepts through the
/// `Other_Alphabetic` property. Excluded so this file's token test matches
/// `FTS_TOKEN_CHAR_RE` (`search-query.ts`) codepoint for codepoint.
const LETTERLIKE_SYMBOL_RANGES: [(char, char); 4] = [
    ('\u{24B6}', '\u{24E9}'),
    ('\u{1F130}', '\u{1F149}'),
    ('\u{1F150}', '\u{1F169}'),
    ('\u{1F170}', '\u{1F189}'),
];

/// The `Co` half of `unicode61`'s default `L* N* Co` categories, which
/// `char::is_alphanumeric` does not cover.
fn is_private_use(character: char) -> bool {
    matches!(character, '\u{E000}'..='\u{F8FF}' | '\u{F0000}'..='\u{FFFFD}' | '\u{100000}'..='\u{10FFFD}')
}

/// A character `unicode61` keeps inside a token, i.e. its default `categories`
/// of `'L* N* Co'`. The twin of `FTS_TOKEN_CHAR_RE` (`search-query.ts`): both
/// sides must classify every codepoint alike, since the parity corpus compares
/// their expressions byte for byte.
fn is_fts_token_char(character: char) -> bool {
    if is_private_use(character) {
        return true;
    }
    character.is_alphanumeric()
        && !is_combining_mark(character)
        && !LETTERLIKE_SYMBOL_RANGES
            .iter()
            .any(|(first, last)| character >= *first && character <= *last)
}

/// Whether `unicode61` finds any token in a term, i.e. whether FTS can see it.
pub fn is_tokenizable(term: &str) -> bool {
    term.chars().any(is_fts_token_char)
}

/// Wrap a term as an FTS5 string literal, doubling quotes (FTS5's own escape).
fn quote_fts_literal(term: &str) -> String {
    format!("\"{}\"", term.replace('"', "\"\""))
}

/// The terms a search constrains on, the twin of `searchTerms`
/// (`search-query.ts`): a term of pure punctuation tokenizes to an empty
/// phrase, which as an operand of the explicit `AND` matches no rows and would
/// take the whole query with it, so it constrains neither the FTS expression
/// nor title recall. When no term survives, the originals are kept: the query
/// is punctuation only, and title recall can still match it literally.
fn search_terms(query: &str) -> Vec<&str> {
    let terms: Vec<&str> = query.split_whitespace().collect();
    let tokenizable: Vec<&str> = terms
        .iter()
        .copied()
        .filter(|term| is_tokenizable(term))
        .collect();
    if tokenizable.is_empty() {
        terms
    } else {
        tokenizable
    }
}

/// Build an FTS5 `MATCH` expression from a free-text query, or `None` when
/// there is nothing to search. Every whitespace-split term is double-quoted
/// (embedded quotes doubled), then matched as a prefix in the title or body
/// column. User operators like `AND`/`*` therefore cannot change the query's
/// meaning or raise syntax errors.
///
/// A punctuation-only query has no tokenizable term to constrain on, so it
/// gets the quoted join: a valid, matchless expression that still lets title
/// recall admit rows.
pub fn build_fts_match(query: &str) -> Option<String> {
    let terms = search_terms(query);
    if terms.is_empty() {
        return None;
    }
    if !terms.iter().any(|term| is_tokenizable(term)) {
        return Some(
            terms
                .into_iter()
                .map(quote_fts_literal)
                .collect::<Vec<_>>()
                .join(" "),
        );
    }
    Some(
        terms
            .into_iter()
            .map(|term| {
                let literal = quote_fts_literal(term);
                format!("(title : {literal}* OR body : {literal}*)")
            })
            .collect::<Vec<_>>()
            .join(" AND "),
    )
}

/// The body half of [`build_fts_match`], the twin of `buildBodyFtsMatch`
/// (`search-query.ts`): rows whose body holds a word prefix of any term —
/// exactly the rows where `snippet()` on the body column marks a match.
/// Ranking asks "did the body match?" with this one extra FTS pass instead of
/// a snippet per hit. `None` exactly when [`build_fts_match`] is.
pub fn build_body_fts_match(query: &str) -> Option<String> {
    let terms = search_terms(query);
    if terms.is_empty() {
        return None;
    }
    if !terms.iter().any(|term| is_tokenizable(term)) {
        let phrases = terms
            .into_iter()
            .map(quote_fts_literal)
            .collect::<Vec<_>>()
            .join(" ");
        return Some(format!("body : ({phrases})"));
    }
    let prefixes = terms
        .into_iter()
        .map(|term| format!("{}*", quote_fts_literal(term)))
        .collect::<Vec<_>>()
        .join(" OR ");
    Some(format!("body : ({prefixes})"))
}

/// Exact-phrase `MATCH` groups (`"quoted"`), the twin of `buildPhraseFtsMatch`
/// (`search-query.ts`): each phrase must appear, words in order, in the
/// title or the body. No prefix operator. `None` when there are no phrases.
pub fn build_phrase_fts_match(phrases: &[String]) -> Option<String> {
    if phrases.is_empty() {
        return None;
    }
    Some(
        phrases
            .iter()
            .map(|phrase| {
                let literal = quote_fts_literal(phrase);
                format!("(title : {literal} OR body : {literal})")
            })
            .collect::<Vec<_>>()
            .join(" AND "),
    )
}

/// The body half of [`build_phrase_fts_match`] (`buildBodyPhraseFtsMatch`).
pub fn build_body_phrase_fts_match(phrases: &[String]) -> Option<String> {
    if phrases.is_empty() {
        return None;
    }
    let literals = phrases
        .iter()
        .map(|phrase| quote_fts_literal(phrase))
        .collect::<Vec<_>>()
        .join(" OR ");
    Some(format!("body : ({literals})"))
}

/// The `-word` / `-"phrase"` exclusion set (`buildExcludedFtsMatch`): rows
/// whose title or body holds any word prefix or exact phrase. Untokenizable
/// entries are dropped; `None` when nothing is left.
pub fn build_excluded_fts_match(terms: &[String], phrases: &[String]) -> Option<String> {
    let literals: Vec<String> = terms
        .iter()
        .filter(|term| is_tokenizable(term))
        .map(|term| format!("{}*", quote_fts_literal(term)))
        .chain(
            phrases
                .iter()
                .filter(|phrase| is_tokenizable(phrase))
                .map(|phrase| quote_fts_literal(phrase)),
        )
        .collect();
    if literals.is_empty() {
        return None;
    }
    let any = literals.join(" OR ");
    Some(format!("title : ({any}) OR body : ({any})"))
}

/// Join present FTS expressions, each parenthesized (`joinFts`).
pub fn join_fts(parts: &[Option<String>], operator: &str) -> Option<String> {
    let present: Vec<&String> = parts.iter().flatten().collect();
    match present.as_slice() {
        [] => None,
        [only] => Some((*only).clone()),
        _ => Some(
            present
                .iter()
                .map(|part| format!("({part})"))
                .collect::<Vec<_>>()
                .join(&format!(" {operator} ")),
        ),
    }
}

/// One search result row.
#[derive(Debug)]
pub struct SearchHit {
    pub path: String,
    pub title: String,
    /// FTS5 `snippet()` over the indexed plain-text body.
    pub snippet: String,
    /// Title-boosted bm25 score (more negative = better); `0` for title-recall hits.
    pub score: f64,
}

/// SQL parameters bound positionally: each `push` returns its `?N`.
#[derive(Default)]
pub struct Binds {
    values: Vec<Value>,
}

impl Binds {
    pub fn push(&mut self, value: Value) -> String {
        self.values.push(value);
        format!("?{}", self.values.len())
    }

    fn text(&mut self, value: &str) -> String {
        self.push(Value::Text(value.to_owned()))
    }
}

/// The search filters as resolved for SQL: the parsed grammar plus the
/// graph paths `links:` / `linked-from:` resolved to (the caller resolves
/// them, refusing private targets).
pub struct ResolvedFilters<'a> {
    pub filters: &'a SearchFilters,
    pub links_to_path: Option<String>,
    pub linked_from_path: Option<String>,
}

/// `notes.path_key`'s last segment: the folded file name (`FILE_NAME_KEY`).
const FILE_NAME_KEY: &str =
    "replace(notes.path_key, rtrim(notes.path_key, replace(notes.path_key, '/', '')), '')";

/// Escape `%`/`_`/`\` for a LIKE pattern with `ESCAPE '\'`.
fn escape_like(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        if matches!(character, '\\' | '%' | '_') {
            escaped.push('\\');
        }
        escaped.push(character);
    }
    escaped
}

/// A tag key that is `tag` itself or nested beneath it (`tagMatchSql`): the
/// nested half is a range so it stays on the `tag_key` index (`0` is the
/// code point after `/`).
fn tag_match_sql(column: &str, tag: &str, binds: &mut Binds) -> String {
    let exact = binds.text(tag);
    let low = binds.text(&format!("{tag}/"));
    let high = binds.text(&format!("{tag}0"));
    format!("({column} = {exact} OR ({column} >= {low} AND {column} < {high}))")
}

/// One property filter (`propertyFilterSql`, TDR 0005): a bare key is
/// existence; a value matches case-insensitively, as a list entry, or as a
/// relation's `[[value]]` / `[[value|alias]]`.
fn property_filter_sql(filter: &PropertyFilter, binds: &mut Binds) -> String {
    let key = binds.text(&filter.key);
    let Some(value) = &filter.value else {
        return format!(
            "EXISTS (SELECT 1 FROM note_properties
                     WHERE note_properties.note_path = notes.path AND note_properties.key = {key})"
        );
    };
    let plain = binds.text(value);
    let wiki = binds.text(&format!("[[{value}]]"));
    let list = binds.text(&format!("%\"{}\"%", escape_like(value)));
    let alias = binds.text(&format!("[[{}|%", escape_like(value)));
    format!(
        "EXISTS (SELECT 1 FROM note_properties
                 WHERE note_properties.note_path = notes.path AND note_properties.key = {key}
                   AND (lower(note_properties.value) = lower({plain})
                     OR lower(note_properties.value) = lower({wiki})
                     OR (note_properties.value_type = 'list'
                       AND lower(note_properties.value) LIKE lower({list}) ESCAPE '\\')
                     OR lower(note_properties.value) LIKE lower({alias}) ESCAPE '\\'))"
    )
}

/// Every filter as a `notes` predicate, the twin of the `where` chain in
/// `searchWithFilters` plus `operatorPredicates` (`search-operators-sql.ts`).
/// Phrases and text exclusions are FTS path sets — one MATCH each, whatever
/// the graph size — so title recall can never admit a row they rule out.
pub fn filter_predicates(resolved: &ResolvedFilters, binds: &mut Binds) -> Vec<String> {
    let filters = resolved.filters;
    let mut predicates = Vec::new();
    for tag in &filters.tags {
        let matches = tag_match_sql("filter_tags.tag_key", tag, binds);
        predicates.push(format!(
            "EXISTS (SELECT 1 FROM tags AS filter_tags
                     WHERE filter_tags.note_path = notes.path AND {matches})"
        ));
    }
    if filters.daily_only {
        predicates.push("notes.daily_date IS NOT NULL".to_string());
    }
    if filters.pinned_only {
        predicates.push("notes.is_pinned = 1".to_string());
    }
    if let Some(target) = &resolved.links_to_path {
        let target = binds.text(target);
        predicates.push(format!(
            "EXISTS (SELECT 1 FROM backlinks
                     WHERE backlinks.source_path = notes.path AND backlinks.target_path = {target})"
        ));
    }
    if let Some(source) = &resolved.linked_from_path {
        let source = binds.text(source);
        predicates.push(format!(
            "EXISTS (SELECT 1 FROM backlinks
                     WHERE backlinks.target_path = notes.path AND backlinks.source_path = {source})"
        ));
    }
    if let Some(after) = filters.updated_after_ms {
        let after = binds.push(Value::Integer(after));
        predicates.push(format!("notes.mtime >= {after}"));
    }
    if let Some(before) = filters.updated_before_ms {
        let before = binds.push(Value::Integer(before));
        predicates.push(format!("notes.mtime < {before}"));
    }
    for property in &filters.properties {
        predicates.push(property_filter_sql(property, binds));
    }
    for tag in &filters.excluded_tags {
        let matches = tag_match_sql("excluded_tags.tag_key", tag, binds);
        predicates.push(format!(
            "NOT EXISTS (SELECT 1 FROM tags AS excluded_tags
                         WHERE excluded_tags.note_path = notes.path AND {matches})"
        ));
    }
    let mut contains = |haystack: &str, needle: &str, negated: bool| {
        let needle = binds.text(&fold_graph_path(needle));
        let comparison = if negated { "= 0" } else { "> 0" };
        format!("instr({haystack}, {needle}) {comparison}")
    };
    for path in &filters.paths {
        predicates.push(contains("notes.path_key", path, false));
    }
    for path in &filters.excluded_paths {
        predicates.push(contains("notes.path_key", path, true));
    }
    for file in &filters.files {
        predicates.push(contains(FILE_NAME_KEY, file, false));
    }
    for file in &filters.excluded_files {
        predicates.push(contains(FILE_NAME_KEY, file, true));
    }
    if let Some(phrases) = build_phrase_fts_match(&filters.phrases) {
        let phrases = binds.text(&phrases);
        predicates.push(format!(
            "notes.path IN (SELECT path FROM search_fts WHERE search_fts MATCH {phrases})"
        ));
    }
    if let Some(excluded) =
        build_excluded_fts_match(&filters.excluded_terms, &filters.excluded_phrases)
    {
        let excluded = binds.text(&excluded);
        predicates.push(format!(
            "notes.path NOT IN (SELECT path FROM search_fts WHERE search_fts MATCH {excluded})"
        ));
    }
    predicates
}

/// `AND`-prefixed predicates, ready to append to a `WHERE`.
fn and_all(predicates: &[String]) -> String {
    predicates
        .iter()
        .map(|predicate| format!(" AND {predicate}"))
        .collect()
}

/// The `instr` needles for title recall, one per folded query term — the twin
/// of `titleRecallNeedles` (`search-query.ts`). Matched against
/// `' ' || notes.title_key`: terms in space-delimited scripts carry a leading
/// space so they only match at word starts (`car` finds `Car log`, not
/// `Oscar party`), while unsegmented-script terms match anywhere. Built from
/// the same [`search_terms`] the FTS expression uses, so a term FTS ignores
/// cannot go on constraining recall.
fn title_recall_needles(title_key: &str) -> Vec<String> {
    search_terms(title_key)
        .into_iter()
        .map(|term| {
            if contains_unsegmented_script(term) {
                term.to_owned()
            } else {
                format!(" {term}")
            }
        })
        .collect()
}

/// The palette search's bm25 column weights (`filtered-search.ts`): path
/// unranked, title boosted 10× over body. Must stay in lockstep.
const RANK_EXPR: &str = "bm25(search_fts, 0, 10.0, 1.0)";

/// A filtered search with no free text: the filtered notes newest first
/// (`recallOrder`), with no snippet or score — the palette's recall feed.
pub fn recall_filtered(
    conn: &Connection,
    resolved: &ResolvedFilters,
    limit: usize,
) -> Result<Vec<SearchHit>, CliError> {
    let mut binds = Binds::default();
    let predicates = and_all(&filter_predicates(resolved, &mut binds));
    let limit = binds.push(Value::Integer(limit as i64));
    let mut statement = conn.prepare(&format!(
        "SELECT notes.path, notes.title FROM notes
         WHERE notes.is_private = 0 AND notes.kind != 'template'{predicates}
         ORDER BY notes.mtime DESC, notes.path ASC
         LIMIT {limit}",
    ))?;
    let rows = statement.query_map(params_from_iter(binds.values), |row| {
        Ok(SearchHit {
            path: row.get(0)?,
            title: row.get(1)?,
            snippet: String::new(),
            score: 0.0,
        })
    })?;
    rows.map(|row| row.map_err(CliError::from)).collect()
}

/// Ranked, private-excluded search mirroring the desktop palette ordering
/// (`filtered-search.ts`): exact, prefix, and all-terms title matches first,
/// then title-boosted bm25, pinned and recency tiebreakers, then `path`. A
/// materialized CTE runs MATCH once because SQLite rejects it beneath a plain
/// OR and otherwise flattens a derived FTS join into one scan per note. The
/// LEFT JOIN admits title-recall-only rows. Matches already covered by title
/// recall keep an empty snippet and score `0`, while tokenizer-normalized title
/// matches retain their lexical rank. The caller re-checks each hit's file
/// frontmatter (the index row may lag a just-flagged note). `resolved`'s
/// filters constrain every row, title-recall rows included.
///
/// `snippet()` costs far more than the match, and a broad term matches most
/// of a big graph, so the CTE carries only rowid and bm25: a second, body-only
/// MATCH (`body_match_expr`, from [`build_body_fts_match`]) supplies the one
/// fact ranking needs, and snippets are computed for the returned rows only.
pub fn search_index(
    conn: &Connection,
    match_expr: &str,
    body_match_expr: &str,
    title_key: &str,
    resolved: &ResolvedFilters,
    limit: usize,
) -> Result<Vec<SearchHit>, CliError> {
    let needles = title_recall_needles(title_key);
    if needles.is_empty() {
        return Ok(Vec::new());
    }
    let mut binds = Binds::default();
    let match_parameter = binds.text(match_expr);
    let title_key_parameter = binds.text(title_key);
    let title_term_predicate = needles
        .iter()
        .map(|needle| format!("instr(' ' || notes.title_key, {}) > 0", binds.text(needle)))
        .collect::<Vec<String>>()
        .join(" AND ");
    let limit_parameter = binds.push(Value::Integer(limit as i64));
    let body_parameter = binds.text(body_match_expr);
    let predicates = and_all(&filter_predicates(resolved, &mut binds));
    let mut statement = conn.prepare(&format!(
        "WITH lexical AS MATERIALIZED (
           SELECT path, rowid AS fts_rowid, {RANK_EXPR} AS rank
           FROM search_fts
           WHERE search_fts MATCH {match_parameter}
         ),
         body_hits AS MATERIALIZED (
           SELECT rowid AS fts_rowid
           FROM search_fts
           WHERE search_fts MATCH {body_parameter}
         )
         SELECT notes.path, notes.title, lexical.fts_rowid,
                CASE
                  WHEN body_hits.fts_rowid IS NOT NULL
                    OR NOT ({title_term_predicate})
                    THEN coalesce(lexical.rank, 0)
                  ELSE 0
                END AS effective_rank
         FROM notes
         LEFT JOIN lexical ON lexical.path = notes.path
         LEFT JOIN body_hits ON body_hits.fts_rowid = lexical.fts_rowid
         WHERE (lexical.path IS NOT NULL OR ({title_term_predicate}))
           AND notes.is_private = 0 AND notes.kind != 'template'{predicates}
         ORDER BY CASE
                    WHEN notes.title_key = {title_key_parameter} THEN 0
                    WHEN instr(notes.title_key, {title_key_parameter}) = 1 THEN 1
                    WHEN {title_term_predicate} THEN 2
                    ELSE 3
                  END,
                  effective_rank,
                  notes.is_pinned DESC,
                  notes.mtime DESC,
                  notes.path ASC
         LIMIT {limit_parameter}",
    ))?;
    let rows = statement.query_map(params_from_iter(binds.values), |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<i64>>(2)?,
            row.get::<_, f64>(3)?,
        ))
    })?;
    let mut ranked = Vec::new();
    for row in rows {
        ranked.push(row?);
    }
    let rowids: Vec<i64> = ranked
        .iter()
        .filter_map(|(_, _, rowid, _)| *rowid)
        .collect();
    let snippets = body_snippets(conn, match_expr, &rowids)?;
    Ok(ranked
        .into_iter()
        .map(|(path, title, rowid, score)| {
            let marked = rowid
                .and_then(|rowid| snippets.get(&rowid))
                .map(String::as_str)
                .unwrap_or("");
            // An unmarked fragment means only the title matched: no snippet.
            let snippet = if marked.contains(HIGHLIGHT_START) {
                marked.replace([HIGHLIGHT_START, HIGHLIGHT_END], "")
            } else {
                String::new()
            };
            SearchHit {
                path,
                title,
                snippet,
                score,
            }
        })
        .collect())
}

/// Marked body snippets for just the returned hits, keyed by FTS rowid: one
/// MATCH pass whose rowid filter runs before `snippet()` is computed. The
/// filter is written `+rowid` on purpose: as a plain rowid constraint FTS5
/// would re-run the whole MATCH once per listed rowid, which for a short
/// prefix costs more than a snippet for every hit.
fn body_snippets(
    conn: &Connection,
    match_expr: &str,
    rowids: &[i64],
) -> Result<HashMap<i64, String>, CliError> {
    if rowids.is_empty() {
        return Ok(HashMap::new());
    }
    let placeholders = (0..rowids.len())
        .map(|index| format!("?{}", index + 2))
        .collect::<Vec<String>>()
        .join(", ");
    let mut statement = conn.prepare(&format!(
        "SELECT rowid, snippet(search_fts, 2, char(1), char(2), '…', 12)
         FROM search_fts
         WHERE search_fts MATCH ?1 AND +rowid IN ({placeholders})",
    ))?;
    let mut parameters = vec![Value::Text(match_expr.to_owned())];
    parameters.extend(rowids.iter().map(|rowid| Value::Integer(*rowid)));
    let rows = statement.query_map(params_from_iter(parameters), |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut snippets = HashMap::new();
    for row in rows {
        let (rowid, snippet) = row?;
        snippets.insert(rowid, snippet);
    }
    Ok(snippets)
}

#[cfg(test)]
mod tests {
    use super::{build_body_fts_match, build_fts_match, title_recall_needles};

    /// Parity with `titleRecallNeedles` (`search-query.ts`): space-delimited
    /// terms anchor at word starts (leading space); unsegmented-script terms
    /// match anywhere (no anchor).
    #[test]
    fn needles_match_the_ts_builder() {
        assert_eq!(title_recall_needles("tokyo 東京"), vec![" tokyo", "東京"]);
        assert_eq!(title_recall_needles("car"), vec![" car"]);
        assert_eq!(title_recall_needles(""), Vec::<String>::new());
    }

    /// Parity with `buildBodyFtsMatch` (`search-query.test.ts`).
    #[test]
    fn body_match_expressions_match_the_ts_builder() {
        assert_eq!(build_body_fts_match("  "), None);
        assert_eq!(
            build_body_fts_match("growth \"loop\""),
            Some("body : (\"growth\"* OR \"\"\"loop\"\"\"*)".to_string())
        );
        assert_eq!(
            build_body_fts_match("... ?"),
            Some("body : (\"...\" \"?\")".to_string())
        );
    }

    /// Parity with `buildFtsMatch` (`search-query.test.ts`) — same inputs,
    /// same expressions, byte for byte.
    #[test]
    fn match_expressions_match_the_ts_builder() {
        assert_eq!(build_fts_match(""), None);
        assert_eq!(build_fts_match("   \t \n "), None);
        assert_eq!(
            build_fts_match("hello"),
            Some("(title : \"hello\"* OR body : \"hello\"*)".to_string())
        );
        assert_eq!(
            build_fts_match("cats AND (dogs*)"),
            Some(
                "(title : \"cats\"* OR body : \"cats\"*) AND (title : \"AND\"* OR body : \"AND\"*) AND (title : \"(dogs*)\"* OR body : \"(dogs*)\"*)"
                    .to_string()
            )
        );
        assert_eq!(
            build_fts_match("say \"hi\""),
            Some(
                "(title : \"say\"* OR body : \"say\"*) AND (title : \"\"\"hi\"\"\"* OR body : \"\"\"hi\"\"\"*)"
                    .to_string()
            )
        );
        assert_eq!(
            build_fts_match("  alpha   beta "),
            Some(
                "(title : \"alpha\"* OR body : \"alpha\"*) AND (title : \"beta\"* OR body : \"beta\"*)"
                    .to_string()
            )
        );
        assert_eq!(
            build_fts_match("meeting - notes"),
            Some(
                "(title : \"meeting\"* OR body : \"meeting\"*) AND (title : \"notes\"* OR body : \"notes\"*)"
                    .to_string()
            )
        );
        assert_eq!(
            build_fts_match("東京 ・"),
            Some("(title : \"東京\"* OR body : \"東京\"*)".to_string())
        );
        assert_eq!(build_fts_match("-"), Some("\"-\"".to_string()));
        assert_eq!(build_fts_match(". -"), Some("\".\" \"-\"".to_string()));
    }

    /// The token test follows unicode61's `L* N* Co` categories, not Rust's
    /// `Alphabetic` property: private use constrains, while combining marks
    /// and enclosed alphanumerics (both `Alphabetic`) do not.
    #[test]
    fn token_classification_matches_the_tokenizer_categories() {
        assert_eq!(
            build_fts_match("\u{F8FF}"),
            Some("(title : \"\u{F8FF}\"* OR body : \"\u{F8FF}\"*)".to_string())
        );
        assert_eq!(
            build_fts_match("hello \u{345}"),
            Some("(title : \"hello\"* OR body : \"hello\"*)".to_string())
        );
        assert_eq!(
            build_fts_match("hello \u{24B6}"),
            Some("(title : \"hello\"* OR body : \"hello\"*)".to_string())
        );
    }

    /// Title recall drops the same terms the FTS expression drops, so a
    /// punctuation term cannot go on constraining recall.
    #[test]
    fn needles_drop_terms_the_fts_expression_ignores() {
        assert_eq!(title_recall_needles("tokyo -"), vec![" tokyo"]);
        // Punctuation only: recall still matches it literally.
        assert_eq!(title_recall_needles("-"), vec![" -"]);
    }
}
