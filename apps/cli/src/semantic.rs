//! The semantic leg of `kore search` and its fusion with the lexical leg —
//! the CLI's twin of `retrieve()` (`packages/core/src/embeddings/retrieve.ts`),
//! so an agent searching through `kore mcp` ranks notes the way the in-app
//! chat's `search_notes` does: embed the query with the app's model, KNN over
//! the chunk vectors the app stored, drop neighbors past the same cosine
//! cutoff, keep each note's best chunk, then reciprocal-rank-fuse with the
//! lexical hits (K = 60, no tuned weights).
//!
//! Semantic search is strictly additive here too. Every way it can be
//! missing — no vectors in the index (semantic search never enabled in the
//! app), no model on this machine, a model whose vectors disagree with the
//! stored ones — degrades to lexical with a reason the caller reports, never
//! an error, unless the caller asked for semantic results only.
//!
//! Privacy: the KNN query keeps only public, non-template notes (the CLI's
//! rule for every listing), and the caller re-checks each hit's file on disk
//! like it does for lexical hits.

use std::collections::{HashMap, HashSet};

use rusqlite::{params, Connection, OptionalExtension};

use crate::embed::{self, Embedder, MODEL_ID};
use crate::search::SearchHit;

/// KNN candidates per query, as in `retrieve.ts`.
const KNN_CANDIDATES: usize = 24;

/// Candidates when search filters narrow the result set: the KNN runs over
/// the whole graph and filtering happens after, so it reaches further.
const FILTERED_KNN_CANDIDATES: usize = 400;

/// `MAX_COSINE_DISTANCE` in `retrieve.ts`: neighbors farther than this are
/// noise, not matches.
const MAX_COSINE_DISTANCE: f64 = 0.7;

/// The standard reciprocal-rank-fusion damping constant (`fuseRanked`).
const RRF_K: f64 = 60.0;

/// The self-check's floor: the CLI's vector for a stored chunk's text must
/// sit this close to the vector the app stored for it. Two runtimes running
/// one float32 model agree to ~1e-6; anything under this is a different
/// model or broken preprocessing.
const PARITY_MIN_COSINE: f32 = 0.99;

/// Longest chunk snippet a semantic-only hit carries in results.
const SNIPPET_CHARS: usize = 240;

/// One KNN row: a note and one of its chunks.
#[derive(Debug, Clone)]
pub struct ChunkHit {
    pub path: String,
    pub title: String,
    pub heading: Option<String>,
    pub text: String,
    pub distance: f64,
}

impl ChunkHit {
    /// The note's result row: its best chunk as the snippet, cosine
    /// similarity as the score (what `bestChunkPerNote` reports).
    fn into_hit(self) -> SearchHit {
        SearchHit {
            snippet: chunk_snippet(&self.text),
            score: 1.0 - self.distance,
            path: self.path,
            title: self.title,
            heading: self.heading,
        }
    }
}

/// A ready semantic engine for one index.
pub struct Semantic {
    embedder: Embedder,
}

/// How many chunks the app stored under the model the CLI can run.
fn stored_chunk_count(conn: &Connection) -> Result<i64, rusqlite::Error> {
    conn.query_row(
        "SELECT count(*) FROM embedding_chunks WHERE model_id = ?1",
        [MODEL_ID],
        |row| row.get(0),
    )
}

impl Semantic {
    /// Load the model and prove it reproduces the app's vectors, or say (in
    /// words for the user) why semantic search is unavailable.
    pub fn open(conn: &Connection) -> Result<Self, String> {
        match stored_chunk_count(conn) {
            Ok(count) if count > 0 => {}
            Ok(_) => {
                return Err(
                    "this graph has no semantic index yet — turn on semantic search in \
                     Kore (Settings → AI) and let it finish"
                        .to_string(),
                )
            }
            Err(err) => return Err(format!("the index has no semantic tables ({err})")),
        }
        let dir = embed::locate_model().ok_or_else(|| {
            "the embedding model is not on this machine — turn on semantic search in the Kore \
             app, or point $KORE_MODEL_DIR at a folder holding all-MiniLM-L6-v2"
                .to_string()
        })?;
        let embedder = Embedder::load(&dir)
            .map_err(|err| format!("the embedding model could not load: {err}"))?;
        let semantic = Self { embedder };
        semantic.check_parity(conn)?;
        Ok(semantic)
    }

    /// Re-embed one chunk the app stored and compare with its stored vector.
    /// The shortest substantial chunk keeps the check cheap.
    fn check_parity(&self, conn: &Connection) -> Result<(), String> {
        let sample: Option<(String, String)> = conn
            .query_row(
                "SELECT c.text, vec_to_json(v.embedding)
                 FROM embedding_chunks c JOIN embedding_vectors v ON v.rowid = c.id
                 WHERE c.model_id = ?1 AND length(c.text) >= 40
                 ORDER BY length(c.text), c.id LIMIT 1",
                [MODEL_ID],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|err| format!("could not read a stored vector: {err}"))?;
        let Some((text, stored)) = sample else {
            // Only tiny chunks: nothing worth comparing against, trust the model.
            return Ok(());
        };
        let stored: Vec<f32> = serde_json::from_str(&stored)
            .map_err(|err| format!("could not read a stored vector: {err}"))?;
        let ours = self
            .embedder
            .embed(&text)
            .map_err(|err| format!("the embedding model failed: {err}"))?;
        let similarity = embed::cosine(&ours, &stored);
        if similarity < PARITY_MIN_COSINE {
            return Err(format!(
                "the CLI's embeddings do not match the app's (cosine {similarity:.3} on a stored \
                 chunk) — semantic search is off until they agree"
            ));
        }
        Ok(())
    }

    /// Nearest notes to `query`, best chunk per note, nearest first. With
    /// `allowed`, only those paths survive (the query's filters).
    pub fn search(
        &self,
        conn: &Connection,
        query: &str,
        limit: usize,
        allowed: Option<&HashSet<String>>,
    ) -> Result<Vec<SearchHit>, String> {
        let vector = self.embedder.embed(query)?;
        let vector = serde_json::to_string(&vector).map_err(|err| err.to_string())?;
        let candidates = if allowed.is_some() {
            FILTERED_KNN_CANDIDATES
        } else {
            KNN_CANDIDATES
        };
        let mut statement = conn
            .prepare(
                "SELECT c.note_path, n.title, c.heading, c.text, v.distance
                 FROM embedding_vectors v
                 JOIN embedding_chunks c ON c.id = v.rowid
                 JOIN notes n ON n.path = c.note_path
                 WHERE v.embedding MATCH ?1 AND k = ?2
                   AND c.model_id = ?3 AND n.is_private = 0 AND n.kind != 'template'
                 ORDER BY v.distance",
            )
            .map_err(|err| err.to_string())?;
        let rows = statement
            .query_map(params![vector, candidates as i64, MODEL_ID], |row| {
                Ok(ChunkHit {
                    path: row.get(0)?,
                    title: row.get(1)?,
                    heading: row.get(2)?,
                    text: row.get(3)?,
                    distance: row.get(4)?,
                })
            })
            .map_err(|err| err.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|err| err.to_string())?;
        let rows = rows
            .into_iter()
            .filter(|row| allowed.is_none_or(|allowed| allowed.contains(&row.path)))
            .collect::<Vec<_>>();
        Ok(best_chunk_per_note(rows, limit)
            .into_iter()
            .map(ChunkHit::into_hit)
            .collect())
    }
}

/// Collapse nearest-first chunk rows into one hit per note (the best chunk
/// wins), dropping rows past the cutoff — `bestChunkPerNote` in TS.
pub fn best_chunk_per_note(rows: Vec<ChunkHit>, limit: usize) -> Vec<ChunkHit> {
    let mut seen = HashSet::new();
    rows.into_iter()
        .filter(|row| row.distance <= MAX_COSINE_DISTANCE)
        .filter(|row| seen.insert(row.path.clone()))
        .take(limit)
        .collect()
}

/// A chunk as a result snippet: one line, at most [`SNIPPET_CHARS`].
fn chunk_snippet(text: &str) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= SNIPPET_CHARS {
        return flat;
    }
    let cut: String = flat.chars().take(SNIPPET_CHARS).collect();
    format!("{}…", cut.trim_end())
}

/// Reciprocal rank fusion of ranked lists — `fuseRanked`: order-based,
/// deterministic, ties keep first-seen order (earlier lists first). A note
/// found by several lists keeps its first form unless that one has no
/// snippet.
pub fn fuse(lists: Vec<Vec<SearchHit>>, limit: usize) -> Vec<SearchHit> {
    let mut fused: Vec<SearchHit> = Vec::new();
    let mut at: HashMap<String, usize> = HashMap::new();
    for list in lists {
        for (index, hit) in list.into_iter().enumerate() {
            let score = 1.0 / (RRF_K + index as f64 + 1.0);
            match at.get(&hit.path) {
                Some(&slot) => {
                    let entry = &mut fused[slot];
                    entry.score += score;
                    if entry.snippet.is_empty() && !hit.snippet.is_empty() {
                        *entry = SearchHit {
                            score: entry.score,
                            ..hit
                        };
                    }
                }
                None => {
                    at.insert(hit.path.clone(), fused.len());
                    fused.push(SearchHit { score, ..hit });
                }
            }
        }
    }
    // Stable: equal scores keep first-seen order, like JS's sort.
    fused.sort_by(|a, b| b.score.total_cmp(&a.score));
    fused.truncate(limit);
    fused
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chunk(path: &str, distance: f64) -> ChunkHit {
        ChunkHit {
            path: path.to_string(),
            title: path.to_string(),
            heading: Some("H".to_string()),
            text: format!("text of {path}"),
            distance,
        }
    }

    fn lexical(path: &str, snippet: &str) -> SearchHit {
        SearchHit {
            path: path.to_string(),
            title: path.to_string(),
            snippet: snippet.to_string(),
            heading: None,
            score: -1.0,
        }
    }

    fn near(path: &str, distance: f64) -> SearchHit {
        chunk(path, distance).into_hit()
    }

    #[test]
    fn keeps_the_best_chunk_per_note_within_the_cutoff() {
        let hits = best_chunk_per_note(
            vec![
                chunk("a.md", 0.2),
                chunk("b.md", 0.3),
                chunk("a.md", 0.4),
                chunk("c.md", 0.71),
            ],
            10,
        );
        let paths: Vec<_> = hits.iter().map(|hit| hit.path.as_str()).collect();
        assert_eq!(paths, ["a.md", "b.md"]);
        assert_eq!(hits[0].distance, 0.2);
        assert_eq!(
            best_chunk_per_note(vec![chunk("a.md", 0.1), chunk("b.md", 0.1)], 1).len(),
            1
        );
    }

    #[test]
    fn fusion_ranks_notes_found_by_both_legs_first() {
        let fused = fuse(
            vec![
                vec![lexical("a.md", "lex a"), lexical("b.md", "")],
                vec![near("c.md", 0.1), near("b.md", 0.2)],
            ],
            10,
        );
        let paths: Vec<_> = fused.iter().map(|hit| hit.path.as_str()).collect();
        // b is in both lists; a (lexical #1) ties c (semantic #1) and keeps
        // first-seen order.
        assert_eq!(paths, ["b.md", "a.md", "c.md"]);
        // b's empty lexical snippet is replaced by its chunk.
        assert_eq!(fused[0].snippet, "text of b.md");
        assert_eq!(fused[0].heading.as_deref(), Some("H"));
        assert_eq!(fused[1].snippet, "lex a");
        let expected = 1.0 / 62.0 + 1.0 / 62.0;
        assert!((fused[0].score - expected).abs() < 1e-12);
        assert_eq!(fuse(vec![vec![lexical("a.md", "")]], 0).len(), 0);
    }

    #[test]
    fn long_chunks_become_one_line_snippets() {
        let snippet = chunk_snippet(&format!("line one\n\n{}", "word ".repeat(100)));
        assert!(snippet.starts_with("line one word"));
        assert!(snippet.ends_with('…'));
        assert!(snippet.chars().count() <= SNIPPET_CHARS + 1);
    }
}
