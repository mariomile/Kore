//! The search filter grammar — the Rust mirror of `parseSearchQuery`
//! (`packages/core/src/indexing/filter-query.ts`), so `kore search` (and the
//! MCP `search` tool, which runs it) understands the same operators as the
//! app's palette: `#tag`, `is:daily`, `is:pinned`, `links:`, `linked-from:`,
//! `updated:`, `prop:`, and Obsidian's `"exact phrase"`, `-word`,
//! `-"phrase"`, `tag:`, `-#tag`, `path:`, `-path:`, `file:`, `-file:`,
//! `[key]`, `[key:value]`. Pure: everything a token does not form stays
//! search text, exactly as in the palette. The SQL these filters become lives
//! in `search.rs`.

use crate::body_tag::{is_letter, is_number, is_tag_name};
use crate::keys::fold_tag;
use crate::paths::parse_calendar_date;
use crate::search::is_tokenizable;

/// One `prop:` / `[key]` token: the key must exist; with `value`, it must match.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PropertyFilter {
    pub key: String,
    pub value: Option<String>,
}

/// The parsed constraints, field for field `SearchFilters` (`filter-query.ts`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SearchFilters {
    /// Folded tag keys every result carries (nested tags included).
    pub tags: Vec<String>,
    pub daily_only: bool,
    pub pinned_only: bool,
    /// A note reference results must link to.
    pub links_to: Option<String>,
    /// A note reference that must link to each result.
    pub linked_from: Option<String>,
    /// Epoch ms of a local day start: `mtime >=` this.
    pub updated_after_ms: Option<i64>,
    /// Epoch ms of a local day start: `mtime <` this.
    pub updated_before_ms: Option<i64>,
    pub properties: Vec<PropertyFilter>,
    pub excluded_tags: Vec<String>,
    pub paths: Vec<String>,
    pub excluded_paths: Vec<String>,
    pub files: Vec<String>,
    pub excluded_files: Vec<String>,
    pub phrases: Vec<String>,
    pub excluded_terms: Vec<String>,
    pub excluded_phrases: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedSearchQuery {
    /// The free text left for FTS, tokens joined by one space.
    pub text: String,
    pub filters: SearchFilters,
    /// Whether any token formed a filter.
    pub filtered: bool,
}

/// JS `\s` beyond Rust's `char::is_whitespace`: the BOM.
fn is_js_whitespace(character: char) -> bool {
    character.is_whitespace() || character == '\u{FEFF}'
}

/// Split on whitespace, keeping `key:"quoted value"` (and bare quotes) whole,
/// and an Obsidian property token `[key:value with spaces]` whole. A `[[` is
/// a wiki link, not a property, so it splits like any other text.
fn tokenize(query: &str) -> Vec<String> {
    let chars: Vec<char> = query.chars().collect();
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    let mut bracketed = false;
    for (index, &character) in chars.iter().enumerate() {
        if current.is_empty() && !quoted && character == '[' && chars.get(index + 1) != Some(&'[') {
            bracketed = true;
            current.push(character);
        } else if bracketed && character == ']' {
            bracketed = false;
            current.push(character);
        } else if character == '"' {
            quoted = !quoted;
            current.push(character);
        } else if !quoted && !bracketed && is_js_whitespace(character) {
            if !current.is_empty() {
                tokens.push(std::mem::take(&mut current));
            }
        } else {
            current.push(character);
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

fn is_quoted(value: &str) -> bool {
    value.len() >= 2 && value.starts_with('"') && value.ends_with('"')
}

fn unquote(value: &str) -> &str {
    if is_quoted(value) {
        &value[1..value.len() - 1]
    } else {
        value
    }
}

/// `token` without an ASCII `prefix`, matched case-insensitively (the TS
/// `token.toLowerCase().startsWith(prefix)`).
fn strip_prefix_ci<'a>(token: &'a str, prefix: &str) -> Option<&'a str> {
    let head = token.get(..prefix.len())?;
    head.eq_ignore_ascii_case(prefix)
        .then(|| &token[prefix.len()..])
}

/// The value of a `key:` token (quotes removed, trimmed), or `None` if empty.
fn operator_value(rest: &str) -> Option<String> {
    let value = unquote(rest).trim();
    (!value.is_empty()).then(|| value.to_string())
}

/// `#name`, `tag:#name` or `tag:name` as a folded tag key, else `None`.
fn tag_key_of(token: &str) -> Option<String> {
    let name = match strip_prefix_ci(token, "tag:") {
        Some(rest) => rest.strip_prefix('#').unwrap_or(rest),
        None => token.strip_prefix('#')?,
    };
    is_tag_name(name).then(|| fold_tag(name))
}

/// A quoted phrase FTS can see (at least one token character), else `None`.
fn phrase_of(token: &str) -> Option<String> {
    if !is_quoted(token) {
        return None;
    }
    let phrase = token[1..token.len() - 1].trim();
    (!phrase.contains('"') && is_tokenizable(phrase)).then(|| phrase.to_string())
}

/// `PROPERTY_KEY_TOKEN_RE`: a letter or digit, then letters, digits, `_`, `-`.
fn is_property_key(key: &str) -> bool {
    let mut chars = key.chars();
    chars
        .next()
        .is_some_and(|first| is_letter(first) || is_number(first))
        && chars.all(|character| {
            is_letter(character) || is_number(character) || matches!(character, '_' | '-')
        })
}

/// Apply one `-`-prefixed token's body as an exclusion. Returns false when
/// the body forms no exclusion, so the whole token stays search text.
fn apply_exclusion(body: &str, filters: &mut SearchFilters) -> bool {
    if let Some(tag) = tag_key_of(body) {
        filters.excluded_tags.push(tag);
        return true;
    }
    if let Some(rest) = strip_prefix_ci(body, "path:") {
        return operator_value(rest).is_some_and(|value| {
            filters.excluded_paths.push(value);
            true
        });
    }
    if let Some(rest) = strip_prefix_ci(body, "file:") {
        return operator_value(rest).is_some_and(|value| {
            filters.excluded_files.push(value);
            true
        });
    }
    if let Some(phrase) = phrase_of(body) {
        filters.excluded_phrases.push(phrase);
        return true;
    }
    if !body.contains('"') && !body.starts_with('-') && is_tokenizable(body) {
        filters.excluded_terms.push(body.to_string());
        return true;
    }
    false
}

/// Obsidian's `[key]` / `[key:value]` property token, else `None`.
fn bracket_property_of(token: &str) -> Option<PropertyFilter> {
    if !token.starts_with('[')
        || token.starts_with("[[")
        || !token.ends_with(']')
        || token.len() < 2
    {
        return None;
    }
    let body = &token[1..token.len() - 1];
    let (key, value) = match body.find(':') {
        None => (body.trim(), None),
        Some(colon) => (
            body[..colon].trim(),
            Some(unquote(body[colon + 1..].trim()).trim().to_string()),
        ),
    };
    (is_property_key(key) && value.as_deref() != Some("")).then(|| PropertyFilter {
        key: key.to_string(),
        value,
    })
}

/// `prop:key` / `prop:key=value`, else `None`.
fn prop_filter_of(body: &str) -> Option<PropertyFilter> {
    let (key, value) = match body.find('=') {
        None => (body, None),
        Some(equals) => (
            &body[..equals],
            Some(unquote(&body[equals + 1..]).trim().to_string()),
        ),
    };
    (is_property_key(key) && value.as_deref() != Some("")).then(|| PropertyFilter {
        key: key.to_string(),
        value,
    })
}

/// Epoch ms of the **local** start of `date` (+`days`), like `localDayStartMs`.
fn local_day_start_ms(date: &str, days: i64) -> Option<i64> {
    let day = date.parse::<jiff::civil::Date>().ok()?;
    let day = day.checked_add(jiff::Span::new().days(days)).ok()?;
    let zoned = day.to_zoned(jiff::tz::TimeZone::system()).ok()?;
    Some(zoned.timestamp().as_millisecond())
}

/// `updated:>D` / `updated:<D` / `updated:D`; false when the value is no real date.
fn apply_updated(value: &str, filters: &mut SearchFilters) -> bool {
    let (op, date) = match value.chars().next() {
        Some(op @ ('>' | '<')) => (Some(op), &value[1..]),
        _ => (None, value),
    };
    if parse_calendar_date(date).is_none() {
        return false;
    }
    let (Some(start), Some(next)) = (local_day_start_ms(date, 0), local_day_start_ms(date, 1))
    else {
        return false;
    };
    match op {
        Some('>') => filters.updated_after_ms = Some(start),
        Some(_) => filters.updated_before_ms = Some(start),
        None => {
            filters.updated_after_ms = Some(start);
            filters.updated_before_ms = Some(next);
        }
    }
    true
}

/// Apply one non-negated operator token; false when it forms no filter.
fn apply_operator(token: &str, filters: &mut SearchFilters) -> bool {
    if let Some(tag) = tag_key_of(token) {
        filters.tags.push(tag);
        return true;
    }
    if let Some(phrase) = phrase_of(token) {
        filters.phrases.push(phrase);
        return true;
    }
    if let Some(property) = bracket_property_of(token) {
        filters.properties.push(property);
        return true;
    }
    if let Some(value) = strip_prefix_ci(token, "path:").and_then(operator_value) {
        filters.paths.push(value);
        return true;
    }
    if let Some(value) = strip_prefix_ci(token, "file:").and_then(operator_value) {
        filters.files.push(value);
        return true;
    }
    if token.eq_ignore_ascii_case("is:daily") {
        filters.daily_only = true;
        return true;
    }
    if token.eq_ignore_ascii_case("is:pinned") {
        filters.pinned_only = true;
        return true;
    }
    if let Some(target) = strip_prefix_ci(token, "links:").and_then(operator_value) {
        filters.links_to = Some(target);
        return true;
    }
    if let Some(target) = strip_prefix_ci(token, "linked-from:").and_then(operator_value) {
        filters.linked_from = Some(target);
        return true;
    }
    if let Some(property) = strip_prefix_ci(token, "prop:").and_then(prop_filter_of) {
        filters.properties.push(property);
        return true;
    }
    if let Some(value) = strip_prefix_ci(token, "updated:") {
        return apply_updated(value, filters);
    }
    false
}

pub fn parse_search_query(query: &str) -> ParsedSearchQuery {
    let mut filters = SearchFilters::default();
    let mut text: Vec<String> = Vec::new();
    let mut filtered = false;
    for token in tokenize(query) {
        let formed = match token.strip_prefix('-') {
            Some(body) if !body.is_empty() => apply_exclusion(body, &mut filters),
            _ => apply_operator(&token, &mut filters),
        };
        if formed {
            filtered = true;
        } else {
            text.push(token);
        }
    }
    ParsedSearchQuery {
        text: text.join(" "),
        filters,
        filtered,
    }
}

#[cfg(test)]
mod tests {
    use super::{local_day_start_ms, parse_search_query, PropertyFilter, SearchFilters};

    fn prop(key: &str, value: Option<&str>) -> PropertyFilter {
        PropertyFilter {
            key: key.to_string(),
            value: value.map(str::to_string),
        }
    }

    // The cases below are `filter-query.test.ts`, one for one.

    #[test]
    fn plain_text_parses_to_text_with_no_filters() {
        let parsed = parse_search_query("rust sqlite notes");
        assert_eq!(parsed.text, "rust sqlite notes");
        assert!(!parsed.filtered);
        assert_eq!(parsed.filters, SearchFilters::default());
    }

    #[test]
    fn extracts_tags_and_keeps_surrounding_text() {
        let parsed = parse_search_query("meeting #Work #q2-plans notes");
        assert_eq!(parsed.filters.tags, ["work", "q2-plans"]);
        assert_eq!(parsed.text, "meeting notes");
        assert!(parsed.filtered);
    }

    #[test]
    fn a_bare_hash_is_text() {
        let parsed = parse_search_query("issue # 42");
        assert!(parsed.filters.tags.is_empty());
        assert_eq!(parsed.text, "issue # 42");
    }

    #[test]
    fn hash_tokens_outside_the_tag_grammar_stay_text() {
        let numeric = parse_search_query("#123 issue");
        assert!(!numeric.filtered);
        assert_eq!(numeric.text, "#123 issue");
        let doubled = parse_search_query("##work notes");
        assert!(!doubled.filtered);
        assert_eq!(doubled.text, "##work notes");
        assert_eq!(parse_search_query("#q2/plans").filters.tags, ["q2/plans"]);
    }

    #[test]
    fn is_daily_and_is_pinned_are_case_insensitive() {
        let daily = parse_search_query("Is:Daily standup");
        assert!(daily.filters.daily_only);
        assert_eq!(daily.text, "standup");
        let pinned = parse_search_query("Is:Pinned roadmap");
        assert!(pinned.filters.pinned_only);
        assert_eq!(pinned.text, "roadmap");
        let unknown = parse_search_query("is:weekly review");
        assert!(!unknown.filtered);
        assert_eq!(unknown.text, "is:weekly review");
    }

    #[test]
    fn links_take_bare_and_quoted_targets() {
        assert_eq!(
            parse_search_query("links:Roadmap")
                .filters
                .links_to
                .as_deref(),
            Some("Roadmap")
        );
        let quoted = parse_search_query("links:\"Project X\" budget");
        assert_eq!(quoted.filters.links_to.as_deref(), Some("Project X"));
        assert_eq!(quoted.text, "budget");
        assert_eq!(
            parse_search_query("linked-from:\"Q2 Plan\"")
                .filters
                .linked_from
                .as_deref(),
            Some("Q2 Plan")
        );
        let empty = parse_search_query("links: something");
        assert_eq!(empty.filters.links_to, None);
        assert_eq!(empty.text, "links: something");
    }

    #[test]
    fn updated_bounds_are_local_day_starts() {
        let day = local_day_start_ms("2026-06-01", 0);
        let next = local_day_start_ms("2026-06-01", 1);
        let after = parse_search_query("updated:>2026-06-01").filters;
        assert_eq!(after.updated_after_ms, day);
        assert_eq!(after.updated_before_ms, None);
        let before = parse_search_query("updated:<2026-06-01").filters;
        assert_eq!(before.updated_before_ms, day);
        assert_eq!(before.updated_after_ms, None);
        let on = parse_search_query("updated:2026-06-01").filters;
        assert_eq!(on.updated_after_ms, day);
        assert_eq!(on.updated_before_ms, next);
    }

    #[test]
    fn an_impossible_date_is_not_a_filter() {
        let parsed = parse_search_query("updated:>2026-02-31 cleanup");
        assert!(!parsed.filtered);
        assert_eq!(parsed.text, "updated:>2026-02-31 cleanup");
    }

    #[test]
    fn composes_mixed_tokens_and_text() {
        let parsed =
            parse_search_query("#work is:daily links:\"Project X\" updated:>2026-01-01 retro");
        assert_eq!(parsed.filters.tags, ["work"]);
        assert!(parsed.filters.daily_only);
        assert_eq!(parsed.filters.links_to.as_deref(), Some("Project X"));
        assert_eq!(
            parsed.filters.updated_after_ms,
            local_day_start_ms("2026-01-01", 0)
        );
        assert_eq!(parsed.text, "retro");
    }

    #[test]
    fn a_colon_inside_ordinary_text_is_untouched() {
        assert_eq!(
            parse_search_query("re: standup notes").text,
            "re: standup notes"
        );
    }

    #[test]
    fn prop_takes_bare_keys_values_and_quoted_values() {
        let parsed =
            parse_search_query("prop:status=reading prop:rating prop:topic=\"deep work\" plan");
        assert_eq!(
            parsed.filters.properties,
            [
                prop("status", Some("reading")),
                prop("rating", None),
                prop("topic", Some("deep work")),
            ]
        );
        assert!(parsed.filtered);
        assert_eq!(parsed.text, "plan");
        let bad = parse_search_query("prop:=x prop:-bad=1 prop:status= plan");
        assert!(bad.filters.properties.is_empty());
        assert_eq!(bad.text, "prop:=x prop:-bad=1 prop:status= plan");
    }

    #[test]
    fn parses_the_obsidian_operators() {
        let parsed = parse_search_query(
            "roadmap \"next quarter\" -draft -\"old plan\" tag:#type/person -#archive path:CRM/ \
             -path:Journal file:Mario -file:copy [status:in progress] [rating]",
        );
        assert_eq!(parsed.text, "roadmap");
        assert!(parsed.filtered);
        let filters = parsed.filters;
        assert_eq!(filters.phrases, ["next quarter"]);
        assert_eq!(filters.excluded_terms, ["draft"]);
        assert_eq!(filters.excluded_phrases, ["old plan"]);
        assert_eq!(filters.tags, ["type/person"]);
        assert_eq!(filters.excluded_tags, ["archive"]);
        assert_eq!(filters.paths, ["CRM/"]);
        assert_eq!(filters.excluded_paths, ["Journal"]);
        assert_eq!(filters.files, ["Mario"]);
        assert_eq!(filters.excluded_files, ["copy"]);
        assert_eq!(
            filters.properties,
            [prop("status", Some("in progress")), prop("rating", None)]
        );
        assert_eq!(parse_search_query("tag:work").filters.tags, ["work"]);
        assert_eq!(
            parse_search_query("path:\"Active Projects\"").filters.paths,
            ["Active Projects"]
        );
    }

    #[test]
    fn half_formed_operators_stay_search_text() {
        let query = "a - b -- path: file: tag:#1 [[Wiki]] [bad key] \"unclosed";
        let parsed = parse_search_query(query);
        assert!(!parsed.filtered);
        assert_eq!(parsed.text, query);
    }
}
