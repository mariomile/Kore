//! `kore neighborhood <note>`: the notes around one note, up to two links
//! away, in one call. What an agent assembles before a meeting or an answer
//! ("the person, their company, its projects, the transcripts") instead of
//! chaining `explain` calls.
//!
//! Links are followed in both directions over the index's `backlinks` view,
//! each edge keeping its relation (the frontmatter key, migration 0028) so
//! `--relation company` walks only `company` edges. Depth 2 expands through
//! ordinary notes only: daily notes are kept as neighbors (they are where
//! things happened) but never expanded, or one busy day would pull in the
//! whole vault; hubs (more than [`HUB_DEGREE`] links, like a `persons.base`
//! every person points `up:` to) are kept but not expanded either. Results are ranked (named relations first, then how many
//! edges tie a note to the ones already found) and capped by `--limit`.
//! Private notes never appear, and each returned note is re-checked on disk.
//! Requires the index (exit 4).

use std::collections::{BTreeMap, HashMap, HashSet};

use serde::Serialize;

use crate::commands::output::print_json;
use crate::commands::{require_index, still_public_on_disk};
use crate::error::CliError;
use crate::graph::Graph;
use crate::link_context::{links_have_relation, relation_column, same_relation};
use crate::note_file::ensure_not_private;
use crate::resolve::resolve_note;

pub const DEFAULT_LIMIT: usize = 40;
pub const MAX_LIMIT: usize = 200;
/// A note with more links than this is a hub (an index note, a `persons.base`
/// every person points `up:` to): returned as a neighbor, never expanded, or
/// depth 2 would be "everyone else who links to the index".
pub const HUB_DEGREE: usize = 50;

/// One edge between two notes, as written: `from` links to `to`.
#[derive(Debug, Clone, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub struct EdgeJson {
    pub from: String,
    pub to: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relation: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NeighborJson {
    pub path: String,
    pub title: String,
    /// 1 for a direct neighbor, 2 for a neighbor's neighbor.
    pub depth: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
    pub tags: Vec<String>,
    /// The edges that tie this note to the center or to a depth-1 note.
    pub via: Vec<EdgeJson>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NeighborhoodJson<'a> {
    path: &'a str,
    title: String,
    depth: usize,
    stale: bool,
    /// More notes matched than `limit` let through.
    truncated: bool,
    notes: Vec<NeighborJson>,
}

/// Per-note facts the ranking and the output need.
struct NoteFacts {
    title: String,
    daily_date: Option<String>,
}

#[derive(Debug, Clone, Copy)]
pub struct Filters<'a> {
    pub depth: usize,
    pub relation: Option<&'a str>,
    pub tag: Option<&'a str>,
    pub limit: usize,
}

pub fn run(graph: &Graph, json: bool, note_arg: &str, filters: Filters) -> Result<(), CliError> {
    if !(1..=2).contains(&filters.depth) {
        return Err(CliError::Usage("--depth must be 1 or 2".to_string()));
    }
    if filters.limit == 0 || filters.limit > MAX_LIMIT {
        return Err(CliError::Usage(format!(
            "--limit must be between 1 and {MAX_LIMIT}"
        )));
    }
    let (opened, staleness) = require_index(&graph.root)?;
    let center = resolve_note(note_arg, &graph.root, Some(&opened.conn))?
        .rel_path()
        .to_string();
    ensure_not_private(&graph.root, &center)?;

    let conn = &opened.conn;
    let facts = note_facts(conn)?;
    let edges = public_edges(conn)?;
    // The tag narrows what is returned, not what is walked: a person found
    // through their company still counts when asking for `--tag project`.
    let tagged = match filters.tag {
        Some(tag) => Some(paths_with_tag(conn, tag)?),
        None => None,
    };
    let (mut notes, truncated) = collect(&center, &edges, &facts, filters, |path| {
        tagged.as_ref().is_none_or(|tagged| tagged.contains(path))
            && still_public_on_disk(&graph.root, path)
    });
    for note in &mut notes {
        note.tags = crate::schema::note_tags(conn, &note.path)?;
    }
    let title = facts
        .get(&center)
        .map(|facts| facts.title.clone())
        .unwrap_or_default();

    if json {
        return print_json(&NeighborhoodJson {
            path: &center,
            title,
            depth: filters.depth,
            stale: staleness.is_stale(),
            truncated,
            notes,
        });
    }
    for note in &notes {
        let relations: Vec<&str> = note
            .via
            .iter()
            .filter_map(|edge| edge.relation.as_deref())
            .collect();
        let relations = if relations.is_empty() {
            String::new()
        } else {
            format!("\t({})", relations.join(", "))
        };
        println!("{}\t{}\t{}{relations}", note.depth, note.path, note.title);
    }
    if truncated {
        crate::commands::warn(format!(
            "more notes matched; showing the first {} (raise --limit)",
            filters.limit
        ));
    }
    Ok(())
}

fn note_facts(conn: &rusqlite::Connection) -> Result<HashMap<String, NoteFacts>, CliError> {
    let mut statement = conn.prepare(
        "SELECT path, title, daily_date FROM notes WHERE is_private = 0 AND kind != 'template'",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            NoteFacts {
                title: row.get(1)?,
                daily_date: row.get(2)?,
            },
        ))
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// The notes carrying `tag` or one of its children (`type` matches
/// `type/person`), case-insensitive, `#` optional.
fn paths_with_tag(conn: &rusqlite::Connection, tag: &str) -> Result<HashSet<String>, CliError> {
    let key = crate::keys::fold_tag(tag.trim_start_matches('#'));
    let mut binds = crate::search::Binds::default();
    let predicate = crate::search::tag_match_sql("tag_key", &key, &mut binds);
    let mut statement = conn.prepare(&format!(
        "SELECT DISTINCT note_path FROM tags WHERE {predicate}"
    ))?;
    let rows = statement.query_map(rusqlite::params_from_iter(binds.values.iter()), |row| {
        row.get::<_, String>(0)
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Every resolved link between two distinct public notes, with its relation.
fn public_edges(conn: &rusqlite::Connection) -> Result<Vec<EdgeJson>, CliError> {
    let relation_sql = relation_column(links_have_relation(conn), "b");
    let mut statement = conn.prepare(&format!(
        "SELECT DISTINCT b.source_path, b.target_path, {relation_sql}
         FROM backlinks b
         JOIN notes source ON source.path = b.source_path AND source.is_private = 0
         JOIN notes target ON target.path = b.target_path AND target.is_private = 0
         WHERE b.source_path != b.target_path"
    ))?;
    let rows = statement.query_map([], |row| {
        Ok(EdgeJson {
            from: row.get(0)?,
            to: row.get(1)?,
            relation: row.get(2)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Walk out from `center` and rank what is found. `accept` re-checks a note
/// on disk (and the tag filter); it runs only on notes about to be returned.
fn collect(
    center: &str,
    edges: &[EdgeJson],
    facts: &HashMap<String, NoteFacts>,
    filters: Filters,
    mut accept: impl FnMut(&str) -> bool,
) -> (Vec<NeighborJson>, bool) {
    let mut adjacency: HashMap<&str, Vec<(&str, &EdgeJson)>> = HashMap::new();
    for edge in edges {
        if let Some(wanted) = filters.relation {
            if !edge
                .relation
                .as_deref()
                .is_some_and(|name| same_relation(name, wanted))
            {
                continue;
            }
        }
        adjacency
            .entry(edge.from.as_str())
            .or_default()
            .push((edge.to.as_str(), edge));
        adjacency
            .entry(edge.to.as_str())
            .or_default()
            .push((edge.from.as_str(), edge));
    }

    // path -> (depth, edges tying it in)
    let mut found: BTreeMap<&str, (usize, Vec<EdgeJson>)> = BTreeMap::new();
    for (neighbor, edge) in adjacency.get(center).into_iter().flatten() {
        if *neighbor == center || !facts.contains_key(*neighbor) {
            continue;
        }
        let entry = found.entry(neighbor).or_insert((1, Vec::new()));
        entry.1.push((*edge).clone());
    }
    if filters.depth == 2 {
        let first: Vec<&str> = found
            .keys()
            .copied()
            .filter(|path| {
                let ordinary = facts
                    .get(*path)
                    .is_some_and(|facts| facts.daily_date.is_none());
                let degree = adjacency.get(*path).map_or(0, Vec::len);
                ordinary && degree <= HUB_DEGREE
            })
            .collect();
        for via in first {
            for (neighbor, edge) in adjacency.get(via).into_iter().flatten() {
                if *neighbor == center || !facts.contains_key(*neighbor) {
                    continue;
                }
                let entry = found.entry(neighbor).or_insert((2, Vec::new()));
                if entry.0 == 2 {
                    entry.1.push((*edge).clone());
                }
            }
        }
    }

    let mut ranked: Vec<(&str, usize, Vec<EdgeJson>)> = found
        .into_iter()
        .map(|(path, (depth, mut via))| {
            via.sort();
            via.dedup();
            (path, depth, via)
        })
        .collect();
    ranked.sort_by(|left, right| {
        let named = |via: &[EdgeJson]| via.iter().any(|edge| edge.relation.is_some());
        let daily = |path: &str| facts.get(path).is_some_and(|f| f.daily_date.is_some());
        left.1
            .cmp(&right.1)
            .then(named(&right.2).cmp(&named(&left.2)))
            .then(right.2.len().cmp(&left.2.len()))
            .then(daily(left.0).cmp(&daily(right.0)))
            .then(left.0.cmp(right.0))
    });

    let mut notes = Vec::new();
    let mut truncated = false;
    let mut checked: HashSet<&str> = HashSet::new();
    for (path, depth, via) in ranked {
        if notes.len() == filters.limit {
            truncated = true;
            break;
        }
        if !checked.insert(path) || !accept(path) {
            continue;
        }
        let Some(note_facts) = facts.get(path) else {
            continue;
        };
        notes.push(NeighborJson {
            path: path.to_string(),
            title: note_facts.title.clone(),
            depth,
            date: note_facts.daily_date.clone(),
            tags: Vec::new(),
            via,
        });
    }
    (notes, truncated)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn edge(from: &str, to: &str, relation: Option<&str>) -> EdgeJson {
        EdgeJson {
            from: from.to_string(),
            to: to.to_string(),
            relation: relation.map(str::to_string),
        }
    }

    fn facts(paths: &[&str]) -> HashMap<String, NoteFacts> {
        paths
            .iter()
            .map(|path| {
                let daily = path.starts_with("daily/");
                (
                    path.to_string(),
                    NoteFacts {
                        title: path.to_string(),
                        daily_date: daily.then(|| "2026-11-15".to_string()),
                    },
                )
            })
            .collect()
    }

    fn filters(depth: usize, relation: Option<&'static str>) -> Filters<'static> {
        Filters {
            depth,
            relation,
            tag: None,
            limit: 10,
        }
    }

    fn paths(notes: &[NeighborJson]) -> Vec<(&str, usize)> {
        notes.iter().map(|n| (n.path.as_str(), n.depth)).collect()
    }

    #[test]
    fn ranks_named_relations_first_and_expands_through_notes_not_dailies() {
        let edges = vec![
            edge("ada", "acme", Some("company")),
            edge("daily/d1", "ada", None),
            edge("ada", "pricing", None),
            edge("acme", "roadmap", Some("project")),
            edge("daily/d1", "noise", None),
        ];
        let facts = facts(&["ada", "acme", "daily/d1", "pricing", "roadmap", "noise"]);
        let (notes, truncated) = collect("ada", &edges, &facts, filters(2, None), |_| true);
        assert!(!truncated);
        assert_eq!(
            paths(&notes),
            vec![("acme", 1), ("pricing", 1), ("daily/d1", 1), ("roadmap", 2)],
            "the daily is a neighbor but is not expanded, so `noise` stays out"
        );
        assert_eq!(notes[0].via, vec![edge("ada", "acme", Some("company"))]);
    }

    #[test]
    fn hubs_are_neighbors_but_never_expanded() {
        let mut edges = vec![edge("ada", "persons", Some("up"))];
        let mut paths_list = vec!["ada".to_string(), "persons".to_string()];
        for i in 0..=HUB_DEGREE {
            edges.push(edge(&format!("p{i}"), "persons", Some("up")));
            paths_list.push(format!("p{i}"));
        }
        let refs: Vec<&str> = paths_list.iter().map(String::as_str).collect();
        let facts = facts(&refs);
        let (notes, _) = collect("ada", &edges, &facts, filters(2, None), |_| true);
        assert_eq!(paths(&notes), vec![("persons", 1)]);
    }

    #[test]
    fn relation_filter_walks_only_those_edges() {
        let edges = vec![
            edge("ada", "acme", Some("company")),
            edge("ada", "pricing", None),
            edge("bob", "acme", Some("Company")),
        ];
        let facts = facts(&["ada", "acme", "pricing", "bob"]);
        let (notes, _) = collect("acme", &edges, &facts, filters(1, Some("company")), |_| {
            true
        });
        assert_eq!(paths(&notes), vec![("ada", 1), ("bob", 1)]);
    }

    #[test]
    fn caps_at_the_limit_and_skips_notes_private_on_disk() {
        let edges: Vec<EdgeJson> = (0..5)
            .map(|i| edge("hub", &format!("n{i}"), None))
            .collect();
        let facts = facts(&["hub", "n0", "n1", "n2", "n3", "n4"]);
        let mut small = filters(1, None);
        small.limit = 2;
        let (notes, truncated) = collect("hub", &edges, &facts, small, |path| path != "n0");
        assert!(truncated);
        assert_eq!(paths(&notes), vec![("n1", 1), ("n2", 1)]);
    }
}
