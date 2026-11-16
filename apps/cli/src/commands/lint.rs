//! `kore lint`: the vault's graph health in one call, for an agent tidying
//! a vault or a person checking an import.
//!
//! Four checks, each capped by `--limit` (counts are always whole):
//!
//! - **broken**: wiki links no note answers to, grouped by target, with
//!   their sources. Dates (`[[2026-11-20]]`, a daily not written yet) and
//!   links to non-note files (`[[persons.base]]`, `[[photo.png]]`) are not
//!   broken.
//! - **orphans**: ordinary notes with no link in or out.
//! - **unlinked**: notes whose title appears in other notes' text without a
//!   link to them (the vault-wide "unlinked mentions").
//! - **relations**: relations that disagree with each other: a `supersedes`
//!   with no `superseded_by` back (any `X` / `X_by` pair the same), and a
//!   typed relation (a tag schema's `relation` field with a `target`) that
//!   points at a note not of that type.
//!
//! Read-only, deterministic. Private notes are never read, counted or
//! named. Requires the index (exit 4).

use std::collections::{BTreeMap, HashMap, HashSet};

use rusqlite::Connection;
use serde::Serialize;

use crate::commands::output::print_json;
use crate::commands::require_index;
use crate::error::CliError;
use crate::graph::Graph;
use crate::keys::{fold_key, fold_tag};
use crate::link_context::{links_have_relation, relation_column, same_relation};
use crate::search::{build_body_phrase_fts_match, tag_match_sql, Binds};

pub const DEFAULT_LIMIT: usize = 50;
pub const MAX_LIMIT: usize = 500;
/// Sources listed per finding; the count says how many exist.
const SOURCES_MAX: usize = 5;
/// The unlinked check runs one phrase query per title: at most this many,
/// the most-linked first (the notes most worth linking to).
const UNLINKED_TITLES_MAX: usize = 3000;
/// Inverse relation pairs beyond the generic `X` / `X_by`.
const INVERSE_PAIRS: &[(&str, &str)] = &[("supersedes", "superseded_by"), ("parent", "child")];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Check {
    Broken,
    Orphans,
    Unlinked,
    Relations,
}

impl Check {
    pub const ALL: [Check; 4] = [
        Check::Broken,
        Check::Orphans,
        Check::Unlinked,
        Check::Relations,
    ];

    pub fn parse(name: &str) -> Result<Check, CliError> {
        match name.trim() {
            "broken" => Ok(Check::Broken),
            "orphans" => Ok(Check::Orphans),
            "unlinked" => Ok(Check::Unlinked),
            "relations" => Ok(Check::Relations),
            other => Err(CliError::Usage(format!(
                "unknown check `{other}` (broken, orphans, unlinked, relations)"
            ))),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SourceJson {
    path: String,
    title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    relation: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BrokenJson {
    /// The target as first written.
    target: String,
    /// How many links point at it.
    count: usize,
    sources: Vec<SourceJson>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NoteRefJson {
    path: String,
    title: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UnlinkedJson {
    path: String,
    title: String,
    /// Notes whose text holds the title without linking to it.
    count: usize,
    sources: Vec<NoteRefJson>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RelationIssueJson {
    /// `missingInverse` or `wrongType`.
    kind: &'static str,
    from: NoteRefJson,
    to: NoteRefJson,
    relation: String,
    /// The inverse relation `to` lacks, or the tag `to` should carry.
    expected: String,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct CountsJson {
    broken: usize,
    orphans: usize,
    unlinked: usize,
    relations: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LintJson {
    stale: bool,
    /// Whole counts per check (findings, before `limit`).
    counts: CountsJson,
    #[serde(skip_serializing_if = "Option::is_none")]
    broken: Option<Vec<BrokenJson>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    orphans: Option<Vec<NoteRefJson>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    unlinked: Option<Vec<UnlinkedJson>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    relations: Option<Vec<RelationIssueJson>>,
}

/// The public, non-template notes: path -> (title, kind).
struct Vault {
    notes: HashMap<String, (String, String)>,
    /// Resolved edges between distinct public notes, with their relation.
    edges: Vec<(String, String, Option<String>)>,
}

impl Vault {
    fn title(&self, path: &str) -> String {
        self.notes
            .get(path)
            .map(|(title, _)| title.clone())
            .unwrap_or_default()
    }

    fn note_ref(&self, path: &str) -> NoteRefJson {
        NoteRefJson {
            path: path.to_string(),
            title: self.title(path),
        }
    }
}

pub fn run(graph: &Graph, json: bool, checks: &[Check], limit: usize) -> Result<(), CliError> {
    if limit == 0 || limit > MAX_LIMIT {
        return Err(CliError::Usage(format!(
            "--limit must be between 1 and {MAX_LIMIT}"
        )));
    }
    let checks: Vec<Check> = if checks.is_empty() {
        Check::ALL.to_vec()
    } else {
        checks.to_vec()
    };
    let (opened, staleness) = require_index(&graph.root)?;
    let conn = &opened.conn;
    let vault = load_vault(conn)?;

    let mut counts = CountsJson::default();
    let mut out = LintJson {
        stale: staleness.is_stale(),
        counts: CountsJson::default(),
        broken: None,
        orphans: None,
        unlinked: None,
        relations: None,
    };
    if checks.contains(&Check::Broken) {
        let mut found = broken_links(conn, &vault)?;
        counts.broken = found.len();
        found.truncate(limit);
        out.broken = Some(found);
    }
    if checks.contains(&Check::Orphans) {
        let mut found = orphans(&vault);
        counts.orphans = found.len();
        found.truncate(limit);
        out.orphans = Some(found);
    }
    if checks.contains(&Check::Unlinked) {
        let mut found = unlinked_mentions(conn, &vault)?;
        counts.unlinked = found.len();
        found.truncate(limit);
        out.unlinked = Some(found);
    }
    if checks.contains(&Check::Relations) {
        let mut found = missing_inverses(&vault);
        found.extend(wrong_types(conn, &vault)?);
        counts.relations = found.len();
        found.truncate(limit);
        out.relations = Some(found);
    }
    out.counts = counts;

    if json {
        return print_json(&out);
    }
    let c = &out.counts;
    println!(
        "broken\t{}\torphans\t{}\tunlinked\t{}\trelations\t{}",
        c.broken, c.orphans, c.unlinked, c.relations
    );
    for item in out.broken.iter().flatten() {
        println!("broken\t{}\t{} links", item.target, item.count);
    }
    for item in out.orphans.iter().flatten() {
        println!("orphan\t{}", item.path);
    }
    for item in out.unlinked.iter().flatten() {
        println!("unlinked\t{}\t{} notes", item.path, item.count);
    }
    for item in out.relations.iter().flatten() {
        println!(
            "relation\t{}\t{} -{}-> {}\texpected {}",
            item.kind, item.from.path, item.relation, item.to.path, item.expected
        );
    }
    Ok(())
}

fn load_vault(conn: &Connection) -> Result<Vault, CliError> {
    let mut statement = conn.prepare(
        "SELECT path, title, kind FROM notes WHERE is_private = 0 AND kind != 'template'",
    )?;
    let notes = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                (row.get::<_, String>(1)?, row.get::<_, String>(2)?),
            ))
        })?
        .collect::<Result<HashMap<_, _>, _>>()?;
    let relation_sql = relation_column(links_have_relation(conn), "b");
    let mut statement = conn.prepare(&format!(
        "SELECT DISTINCT b.source_path, b.target_path, {relation_sql} FROM backlinks b
         WHERE b.source_path != b.target_path"
    ))?;
    let edges = statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
        .collect::<Result<Vec<(String, String, Option<String>)>, _>>()?
        .into_iter()
        .filter(|(from, to, _)| notes.contains_key(from) && notes.contains_key(to))
        .collect();
    Ok(Vault { notes, edges })
}

/// A target that is not a missing note: a date (a daily not written yet),
/// a heading of the same note, or a file that is not Markdown.
fn is_exempt_target(target: &str) -> bool {
    let target = target.split('#').next().unwrap_or("").trim();
    if target.is_empty() || crate::paths::parse_calendar_date(target).is_some() {
        return true;
    }
    let name = target.rsplit('/').next().unwrap_or(target);
    match name.rsplit_once('.') {
        Some((stem, extension)) => {
            !stem.is_empty()
                && (1..=5).contains(&extension.len())
                && extension.chars().all(|c| c.is_ascii_alphanumeric())
                && !extension.eq_ignore_ascii_case("md")
        }
        None => false,
    }
}

fn broken_links(conn: &Connection, vault: &Vault) -> Result<Vec<BrokenJson>, CliError> {
    let mut resolved: HashSet<(String, i64)> = HashSet::new();
    let mut statement = conn.prepare("SELECT source_path, pos_from FROM backlinks")?;
    for row in statement.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))? {
        resolved.insert(row?);
    }
    let relation_sql = relation_column(links_have_relation(conn), "l");
    let mut statement = conn.prepare(&format!(
        "SELECT l.source_path, l.pos_from, l.target_raw, {relation_sql}
         FROM links l WHERE l.kind = 'wiki' ORDER BY l.source_path, l.pos_from"
    ))?;
    let mut groups: BTreeMap<String, BrokenJson> = BTreeMap::new();
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<String>>(3)?,
        ))
    })?;
    for row in rows {
        let (source, pos_from, target, relation) = row?;
        if !vault.notes.contains_key(&source)
            || resolved.contains(&(source.clone(), pos_from))
            || is_exempt_target(&target)
        {
            continue;
        }
        let group = groups
            .entry(fold_key(target.split('#').next().unwrap_or(&target)))
            .or_insert_with(|| BrokenJson {
                target: target.clone(),
                count: 0,
                sources: Vec::new(),
            });
        group.count += 1;
        if group.sources.len() < SOURCES_MAX && !group.sources.iter().any(|s| s.path == source) {
            group.sources.push(SourceJson {
                title: vault.title(&source),
                path: source,
                relation,
            });
        }
    }
    let mut found: Vec<BrokenJson> = groups.into_values().collect();
    found.sort_by(|left, right| {
        right
            .count
            .cmp(&left.count)
            .then(left.target.cmp(&right.target))
    });
    Ok(found)
}

fn orphans(vault: &Vault) -> Vec<NoteRefJson> {
    let mut linked: HashSet<&str> = HashSet::new();
    for (from, to, _) in &vault.edges {
        linked.insert(from);
        linked.insert(to);
    }
    let mut found: Vec<NoteRefJson> = vault
        .notes
        .iter()
        .filter(|(path, (_, kind))| kind == "note" && !linked.contains(path.as_str()))
        .map(|(path, _)| vault.note_ref(path))
        .collect();
    found.sort_by(|left, right| left.path.cmp(&right.path));
    found
}

/// A title worth looking for in other notes' text: long enough to mean
/// something and not a bare number or date.
fn is_mention_title(title: &str) -> bool {
    let title = title.trim();
    title.chars().count() >= 4
        && title.chars().any(char::is_alphabetic)
        && crate::search::is_tokenizable(title)
}

fn unlinked_mentions(conn: &Connection, vault: &Vault) -> Result<Vec<UnlinkedJson>, CliError> {
    let mut inbound: HashMap<&str, HashSet<&str>> = HashMap::new();
    for (from, to, _) in &vault.edges {
        inbound
            .entry(to.as_str())
            .or_default()
            .insert(from.as_str());
    }
    let mut candidates: Vec<(&str, &str)> = vault
        .notes
        .iter()
        .filter(|(_, (title, kind))| kind == "note" && is_mention_title(title))
        .map(|(path, (title, _))| (path.as_str(), title.as_str()))
        .collect();
    candidates.sort_by(|left, right| {
        let count = |path: &str| inbound.get(path).map_or(0, HashSet::len);
        count(right.0).cmp(&count(left.0)).then(left.0.cmp(right.0))
    });
    candidates.truncate(UNLINKED_TITLES_MAX);

    let mut statement = conn.prepare_cached(
        "SELECT search_fts.path FROM search_fts
         JOIN notes ON notes.path = search_fts.path
         WHERE search_fts MATCH ?1 AND notes.is_private = 0 AND notes.kind != 'template'",
    )?;
    let mut found = Vec::new();
    for (path, title) in candidates {
        let Some(expr) = build_body_phrase_fts_match(&[title.to_string()]) else {
            continue;
        };
        let linked = inbound.get(path);
        let mut sources: Vec<String> = statement
            .query_map([expr], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .filter(|source| {
                source != path && !linked.is_some_and(|linked| linked.contains(source.as_str()))
            })
            .collect();
        if sources.is_empty() {
            continue;
        }
        sources.sort();
        let count = sources.len();
        found.push(UnlinkedJson {
            path: path.to_string(),
            title: title.to_string(),
            count,
            sources: sources
                .iter()
                .take(SOURCES_MAX)
                .map(|source| vault.note_ref(source))
                .collect(),
        });
    }
    found.sort_by(|left, right| {
        right
            .count
            .cmp(&left.count)
            .then(left.path.cmp(&right.path))
    });
    Ok(found)
}

/// The inverse of `relation`, when it has one: a known pair, or `X` / `X_by`.
fn inverse_of(relation: &str) -> Option<String> {
    let key = relation.to_lowercase();
    for (left, right) in INVERSE_PAIRS {
        if key == *left {
            return Some((*right).to_string());
        }
        if key == *right {
            return Some((*left).to_string());
        }
    }
    key.strip_suffix("_by")
        .map(str::to_string)
        .filter(|stem| !stem.is_empty())
}

fn missing_inverses(vault: &Vault) -> Vec<RelationIssueJson> {
    // Only relations whose inverse key is used somewhere in the vault: a
    // lone `reviewed_by` with no `reviewed` key anywhere is a one-way
    // relation by design, not an inconsistency.
    let used: HashSet<String> = vault
        .edges
        .iter()
        .filter_map(|(_, _, relation)| relation.as_ref().map(|r| r.to_lowercase()))
        .collect();
    let present: HashSet<(&str, &str, String)> = vault
        .edges
        .iter()
        .filter_map(|(from, to, relation)| {
            relation
                .as_ref()
                .map(|r| (from.as_str(), to.as_str(), r.to_lowercase()))
        })
        .collect();
    let mut found = Vec::new();
    for (from, to, relation) in &vault.edges {
        let Some(relation) = relation else { continue };
        let Some(inverse) = inverse_of(relation) else {
            continue;
        };
        if !used.contains(&inverse) {
            continue;
        }
        if !present.contains(&(to.as_str(), from.as_str(), inverse.clone())) {
            found.push(RelationIssueJson {
                kind: "missingInverse",
                from: vault.note_ref(from),
                to: vault.note_ref(to),
                relation: relation.clone(),
                expected: inverse,
            });
        }
    }
    found.sort_by(|left, right| {
        (&left.from.path, &left.to.path).cmp(&(&right.from.path, &right.to.path))
    });
    found
}

/// The notes carrying `tag` (or a child of it), as members.
fn tag_members(conn: &Connection, tag: &str) -> Result<HashSet<String>, CliError> {
    let has_member = conn
        .prepare("SELECT 1 FROM pragma_table_info('tags') WHERE name = 'member'")
        .and_then(|mut statement| statement.exists([]))
        .unwrap_or(false);
    let mut binds = Binds::default();
    let predicate = tag_match_sql("tag_key", &fold_tag(tag), &mut binds);
    let member = if has_member { " AND member = 1" } else { "" };
    let mut statement = conn.prepare(&format!(
        "SELECT DISTINCT note_path FROM tags WHERE {predicate}{member}"
    ))?;
    let rows = statement.query_map(rusqlite::params_from_iter(binds.values.iter()), |row| {
        row.get::<_, String>(0)
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn wrong_types(conn: &Connection, vault: &Vault) -> Result<Vec<RelationIssueJson>, CliError> {
    let mut statement = conn.prepare("SELECT tag_key FROM tag_types ORDER BY tag_key")?;
    let tags: Vec<String> = statement
        .query_map([], |row| row.get(0))?
        .collect::<Result<_, _>>()?;
    let mut found = Vec::new();
    let mut members_cache: HashMap<String, HashSet<String>> = HashMap::new();
    for tag in tags {
        let Some(schema) = crate::schema::load_schema(conn, &tag)? else {
            continue;
        };
        for property in &schema.properties {
            let target = match (property.kind.as_str(), &property.target) {
                ("relation" | "relations", Some(target)) => target.clone(),
                ("person", target) => target.clone().unwrap_or_else(|| "person".to_string()),
                _ => continue,
            };
            if !members_cache.contains_key(&tag) {
                members_cache.insert(tag.clone(), tag_members(conn, &tag)?);
            }
            if !members_cache.contains_key(&target) {
                members_cache.insert(target.clone(), tag_members(conn, &target)?);
            }
            let targets = &members_cache[&target];
            if targets.is_empty() {
                // No note carries the target type yet: nothing to agree with.
                continue;
            }
            let sources = &members_cache[&tag];
            for (from, to, relation) in &vault.edges {
                let Some(relation) = relation else { continue };
                if same_relation(relation, &property.key)
                    && sources.contains(from)
                    && !targets.contains(to)
                {
                    found.push(RelationIssueJson {
                        kind: "wrongType",
                        from: vault.note_ref(from),
                        to: vault.note_ref(to),
                        relation: relation.clone(),
                        expected: target.clone(),
                    });
                }
            }
        }
    }
    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates_files_and_headings_are_not_broken_targets() {
        assert!(is_exempt_target("2026-11-20"));
        assert!(is_exempt_target("persons.base"));
        assert!(is_exempt_target("assets/photo.png"));
        assert!(is_exempt_target("#Heading"));
        assert!(!is_exempt_target("Missing Note"));
        assert!(!is_exempt_target("notes/missing.md"));
        assert!(!is_exempt_target("Dr. Who"));
    }

    #[test]
    fn inverses_pair_known_keys_and_x_by() {
        assert_eq!(inverse_of("supersedes").as_deref(), Some("superseded_by"));
        assert_eq!(inverse_of("Superseded_by").as_deref(), Some("supersedes"));
        assert_eq!(inverse_of("owned_by").as_deref(), Some("owned"));
        assert_eq!(inverse_of("company"), None);
    }

    fn vault(edges: &[(&str, &str, Option<&str>)]) -> Vault {
        let mut notes = HashMap::new();
        for (from, to, _) in edges {
            for path in [from, to] {
                notes.insert(path.to_string(), (path.to_string(), "note".to_string()));
            }
        }
        notes.insert(
            "lonely".to_string(),
            ("lonely".to_string(), "note".to_string()),
        );
        notes.insert(
            "daily".to_string(),
            ("day".to_string(), "daily".to_string()),
        );
        Vault {
            notes,
            edges: edges
                .iter()
                .map(|(from, to, relation)| {
                    (
                        from.to_string(),
                        to.to_string(),
                        relation.map(str::to_string),
                    )
                })
                .collect(),
        }
    }

    #[test]
    fn a_supersedes_without_its_superseded_by_is_reported() {
        let vault = vault(&[
            ("v2", "v1", Some("supersedes")),
            ("v1", "v2", Some("superseded_by")),
            ("v3", "v2", Some("supersedes")),
        ]);
        let found = missing_inverses(&vault);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].from.path, "v3");
        assert_eq!(found[0].expected, "superseded_by");
    }

    #[test]
    fn orphans_are_ordinary_notes_with_no_links() {
        let vault = vault(&[("a", "b", None)]);
        let found: Vec<String> = orphans(&vault).into_iter().map(|n| n.path).collect();
        assert_eq!(found, vec!["lonely"]);
    }
}
