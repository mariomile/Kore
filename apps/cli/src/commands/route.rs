//! `kore route <from> <to>`: the shortest chain of wiki links joining two
//! notes, followed in either direction, so an agent can answer "how is A
//! related to B" with one call instead of walking links note by note. Reads
//! the index's `backlinks` view (the app's own link resolution) and requires
//! it (exit 4). Private notes are never stepped through: index-private rows
//! are left out of the graph, and every note on a found route is re-checked
//! on disk; one that turned private is removed and the search runs again.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};

use crate::commands::output::{print_json, RouteJson, RouteNoteJson, RouteStepJson};
use crate::commands::{require_index, still_public_on_disk};
use crate::error::CliError;
use crate::graph::Graph;
use crate::note_file::ensure_not_private;
use crate::resolve::resolve_note;

/// Which way the link between two consecutive notes points.
#[derive(Clone, Copy)]
enum Direction {
    /// The previous note links to this one.
    Links,
    /// This note links to the previous one.
    LinkedFrom,
}

impl Direction {
    fn as_str(self) -> &'static str {
        match self {
            Direction::Links => "links",
            Direction::LinkedFrom => "linkedFrom",
        }
    }
}

/// Undirected adjacency, each neighbor remembering the link's direction.
type Adjacency = BTreeMap<String, BTreeMap<String, Direction>>;

pub fn run(
    graph: &Graph,
    json: bool,
    from_arg: &str,
    to_arg: &str,
    max_hops: usize,
) -> Result<(), CliError> {
    let (opened, staleness) = require_index(&graph.root)?;
    let from = resolve_note(from_arg, &graph.root, Some(&opened.conn))?
        .rel_path()
        .to_string();
    let to = resolve_note(to_arg, &graph.root, Some(&opened.conn))?
        .rel_path()
        .to_string();
    ensure_not_private(&graph.root, &from)?;
    ensure_not_private(&graph.root, &to)?;

    let mut statement = opened.conn.prepare(
        "SELECT b.source_path, b.target_path
         FROM backlinks b
         JOIN notes source ON source.path = b.source_path AND source.is_private = 0
         JOIN notes target ON target.path = b.target_path AND target.is_private = 0
         WHERE b.source_path != b.target_path",
    )?;
    let mut adjacency: Adjacency = BTreeMap::new();
    for row in statement.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })? {
        let (source, target) = row?;
        adjacency
            .entry(source.clone())
            .or_default()
            .entry(target.clone())
            .or_insert(Direction::Links);
        adjacency
            .entry(target)
            .or_default()
            .entry(source)
            .or_insert(Direction::LinkedFrom);
    }

    let mut banned: HashSet<String> = HashSet::new();
    let route = loop {
        let Some(route) = shortest_route(&adjacency, &banned, &from, &to, max_hops) else {
            break None;
        };
        let turned_private: Vec<String> = route
            .iter()
            .map(|(path, _)| path.clone())
            .filter(|path| *path != from && *path != to && !still_public_on_disk(&graph.root, path))
            .collect();
        if turned_private.is_empty() {
            break Some(route);
        }
        banned.extend(turned_private);
    };

    let titles = titles(&opened.conn)?;
    let note = |path: &str| RouteNoteJson {
        path: path.to_string(),
        title: titles.get(path).cloned().unwrap_or_default(),
    };
    let steps: Vec<RouteStepJson> = route
        .unwrap_or_default()
        .into_iter()
        .skip(1)
        .map(|(path, direction)| RouteStepJson {
            path: path.clone(),
            title: titles.get(&path).cloned().unwrap_or_default(),
            direction: direction.map_or("links", Direction::as_str),
        })
        .collect();
    let found = from == to || !steps.is_empty();

    if json {
        return print_json(&RouteJson {
            from: note(&from),
            to: note(&to),
            found,
            hops: steps.len(),
            stale: staleness.is_stale(),
            steps,
        });
    }
    if !found {
        return Err(CliError::NotFound(format!(
            "no link route from {from} to {to} within {max_hops} hops"
        )));
    }
    println!("{from}");
    for step in &steps {
        let arrow = match step.direction {
            "links" => "->",
            _ => "<-",
        };
        println!("{arrow} {}", step.path);
    }
    Ok(())
}

/// Breadth-first search over the undirected link graph. Neighbors are
/// visited in path order, so the same graph always yields the same route.
/// Returns every note on the route from `from` to `to`, each with the
/// direction of the link that reached it (`None` for `from`).
fn shortest_route(
    adjacency: &Adjacency,
    banned: &HashSet<String>,
    from: &str,
    to: &str,
    max_hops: usize,
) -> Option<Vec<(String, Option<Direction>)>> {
    if from == to {
        return Some(vec![(from.to_string(), None)]);
    }
    let mut parents: HashMap<String, (String, Direction)> = HashMap::new();
    let mut visited: BTreeSet<String> = BTreeSet::from([from.to_string()]);
    let mut queue: VecDeque<(String, usize)> = VecDeque::from([(from.to_string(), 0)]);
    while let Some((current, depth)) = queue.pop_front() {
        if depth == max_hops {
            continue;
        }
        let Some(neighbors) = adjacency.get(&current) else {
            continue;
        };
        for (neighbor, direction) in neighbors {
            if banned.contains(neighbor) || !visited.insert(neighbor.clone()) {
                continue;
            }
            parents.insert(neighbor.clone(), (current.clone(), *direction));
            if neighbor == to {
                let mut route = vec![(to.to_string(), Some(*direction))];
                let mut cursor = current.clone();
                while cursor != from {
                    let (parent, reached_by) = &parents[&cursor];
                    route.push((cursor.clone(), Some(*reached_by)));
                    cursor = parent.clone();
                }
                route.push((from.to_string(), None));
                route.reverse();
                return Some(route);
            }
            queue.push_back((neighbor.clone(), depth + 1));
        }
    }
    None
}

fn titles(conn: &rusqlite::Connection) -> Result<HashMap<String, String>, CliError> {
    let mut statement = conn.prepare("SELECT path, title FROM notes")?;
    let rows = statement.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn graph(edges: &[(&str, &str)]) -> Adjacency {
        let mut adjacency: Adjacency = BTreeMap::new();
        for (source, target) in edges {
            adjacency
                .entry(source.to_string())
                .or_default()
                .insert(target.to_string(), Direction::Links);
            adjacency
                .entry(target.to_string())
                .or_default()
                .insert(source.to_string(), Direction::LinkedFrom);
        }
        adjacency
    }

    fn paths(route: &[(String, Option<Direction>)]) -> Vec<&str> {
        route.iter().map(|(path, _)| path.as_str()).collect()
    }

    #[test]
    fn follows_links_in_both_directions_and_skips_banned_notes() {
        // a -> b <- c -> d, plus a longer a -> e -> f -> d.
        let adjacency = graph(&[
            ("a", "b"),
            ("c", "b"),
            ("c", "d"),
            ("a", "e"),
            ("e", "f"),
            ("f", "d"),
        ]);
        let route = shortest_route(&adjacency, &HashSet::new(), "a", "d", 6).expect("route");
        assert_eq!(paths(&route), ["a", "b", "c", "d"]);
        assert!(matches!(route[2].1, Some(Direction::LinkedFrom)));

        let banned = HashSet::from(["b".to_string()]);
        let detour = shortest_route(&adjacency, &banned, "a", "d", 6).expect("detour");
        assert_eq!(paths(&detour), ["a", "e", "f", "d"]);
        assert!(shortest_route(&adjacency, &banned, "a", "d", 2).is_none());
    }
}
