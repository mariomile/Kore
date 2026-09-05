//! End-to-end tests: run the real `reflect` binary against fixture graphs.
//! Index fixtures are built with the shared `reflect-index-schema` migrations
//! plus direct row inserts that mirror the desktop's `apply_note` write path
//! (`apps/desktop/src-tauri/src/db/write.rs`), so the CLI is tested against
//! the schema the app actually writes.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use rusqlite::params;
use tempfile::TempDir;

use reflect_cli::hash::hash_content;
use reflect_cli::keys::fold_key;
use reflect_cli::note_file::parse_note_meta;
use reflect_cli::paths::{daily_path, today_date};

/// `note_claims.tier` values (the desktop's `claim_tier`): lower wins.
const TIER_DAILY_DATE: i64 = 1;
const TIER_TITLE: i64 = 2;
const TIER_ALIAS: i64 = 3;
const TIER_BASENAME: i64 = 4;

struct Fixture {
    dir: TempDir,
}

impl Fixture {
    fn root(&self) -> &Path {
        self.dir.path()
    }

    fn write_note(&self, rel_path: &str, content: &str) -> PathBuf {
        let absolute = self.root().join(rel_path);
        fs::create_dir_all(absolute.parent().unwrap()).unwrap();
        fs::write(&absolute, content).unwrap();
        absolute
    }

    /// Index every note on disk the way the desktop pipeline would: derived
    /// title/aliases/private, content hash, file mtime, FTS row.
    fn build_index(&self) {
        let conn = reflect_index_schema::open_index_at(self.root()).unwrap();
        for note in reflect_cli::note_file::walk_notes(self.root()) {
            let content = fs::read_to_string(self.root().join(&note.rel_path)).unwrap();
            let meta = parse_note_meta(&note.rel_path, &content);
            let daily_date = reflect_cli::paths::date_from_daily_path(&note.rel_path);
            let kind = if daily_date.is_some() {
                "daily"
            } else {
                "note"
            };
            conn.execute(
                "INSERT INTO notes(path, id, title, title_key, kind, daily_date, is_private,
                                   is_pinned, pinned_order, file_hash, mtime, updated_at, preview)
                 VALUES(?1, ?8, ?2, ?3, ?9, ?4, ?5, 0, NULL, ?6, ?7, ?7, '')",
                params![
                    note.rel_path,
                    meta.title,
                    fold_key(&meta.title),
                    daily_date,
                    i64::from(meta.private),
                    hash_content(&content),
                    note.mtime_ms as i64,
                    meta.id,
                    kind,
                ],
            )
            .unwrap();
            for alias in &meta.aliases {
                conn.execute(
                    "INSERT INTO aliases(note_path, alias, alias_key) VALUES(?1, ?2, ?3)",
                    params![note.rel_path, alias, fold_key(alias)],
                )
                .unwrap();
            }
            // The spellings this note answers to, mirroring the desktop's
            // `projectNoteClaims`: date, title, aliases, filename stem, first
            // claim of a key wins.
            let stem = {
                let filename = note.rel_path.rsplit('/').next().unwrap_or(&note.rel_path);
                filename.strip_suffix(".md").unwrap_or(filename)
            };
            let mut claims: Vec<(String, i64)> = Vec::new();
            let claim = |claims: &mut Vec<(String, i64)>, key: String, tier: i64| {
                if !key.is_empty() && !claims.iter().any(|(existing, _)| *existing == key) {
                    claims.push((key, tier));
                }
            };
            if let Some(date) = daily_date {
                // Calendar-valid only: an impossible `daily/2026-02-31.md` is
                // an ordinary note and must never claim a date.
                if reflect_cli::paths::parse_calendar_date(date).is_some() {
                    claim(&mut claims, date.to_string(), TIER_DAILY_DATE);
                }
            }
            claim(&mut claims, fold_key(&meta.title), TIER_TITLE);
            for alias in &meta.aliases {
                claim(&mut claims, fold_key(alias), TIER_ALIAS);
            }
            claim(&mut claims, fold_key(stem), TIER_BASENAME);
            for (key, tier) in &claims {
                conn.execute(
                    "INSERT INTO note_claims(note_path, key, tier) VALUES(?1, ?2, ?3)",
                    params![note.rel_path, key, tier],
                )
                .unwrap();
            }
            conn.execute(
                "INSERT INTO search_fts(path, title, body) VALUES(?1, ?2, ?3)",
                params![note.rel_path, meta.title, content],
            )
            .unwrap();
        }
    }
}

/// A graph with the standard layout but no index file.
fn graph() -> Fixture {
    let dir = TempDir::new().unwrap();
    for sub in [".reflect", "daily", "notes"] {
        fs::create_dir_all(dir.path().join(sub)).unwrap();
    }
    Fixture { dir }
}

fn reflect(fixture: &Fixture, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_reflect"))
        .args(args)
        .current_dir(fixture.root())
        .env_remove("REFLECT_GRAPH")
        .output()
        .unwrap()
}

fn stdout(output: &Output) -> String {
    String::from_utf8(output.stdout.clone()).unwrap()
}

fn stderr(output: &Output) -> String {
    String::from_utf8(output.stderr.clone()).unwrap()
}

fn json(output: &Output) -> serde_json::Value {
    serde_json::from_str(&stdout(output)).unwrap()
}

// ---- today ------------------------------------------------------------------

#[test]
fn today_prints_the_daily_note_with_no_index() {
    let fixture = graph();
    let content = "remember the milk\n";
    fixture.write_note(&daily_path(&today_date()), content);

    let output = reflect(&fixture, &["today"]);
    assert!(output.status.success(), "stderr: {}", stderr(&output));
    assert_eq!(stdout(&output), content);
}

#[test]
fn today_path_prints_the_would_be_path_before_the_file_exists() {
    let fixture = graph();
    let output = reflect(&fixture, &["today", "--path"]);
    assert!(output.status.success());
    let expected = daily_path(&today_date());
    assert!(stdout(&output).trim_end().ends_with(&expected));

    let missing = reflect(&fixture, &["today"]);
    assert_eq!(missing.status.code(), Some(3));
    assert!(stderr(&missing).contains("no daily note"));
}

#[test]
fn today_json_shape() {
    let fixture = graph();
    fixture.write_note(&daily_path(&today_date()), "# Plans\nship it\n");

    let value = json(&reflect(&fixture, &["today", "--json"]));
    assert_eq!(value["date"], today_date());
    assert_eq!(value["path"], daily_path(&today_date()));
    assert_eq!(value["title"], "Plans");
    assert_eq!(value["content"], "# Plans\nship it\n");
    assert!(value["absolutePath"].as_str().unwrap().starts_with('/'));
}

#[test]
fn today_refuses_a_private_daily() {
    let fixture = graph();
    fixture.write_note(
        &daily_path(&today_date()),
        "---\nprivate: true\n---\nsecret plans\n",
    );

    let output = reflect(&fixture, &["today"]);
    assert_eq!(output.status.code(), Some(3));
    assert_eq!(stdout(&output), "");
    assert!(stderr(&output).contains("private"));

    let path_output = reflect(&fixture, &["today", "--path"]);
    assert_eq!(path_output.status.code(), Some(3));
}

// ---- graph resolution ---------------------------------------------------------

#[test]
fn graph_resolves_by_walking_up_from_a_subdirectory() {
    let fixture = graph();
    let content = "found from a subdir\n";
    fixture.write_note(&daily_path(&today_date()), content);

    let output = Command::new(env!("CARGO_BIN_EXE_reflect"))
        .args(["today"])
        .current_dir(fixture.root().join("notes"))
        .env_remove("REFLECT_GRAPH")
        .output()
        .unwrap();
    assert!(output.status.success());
    assert_eq!(stdout(&output), content);
}

#[test]
fn explicit_graph_flag_rejects_a_non_graph() {
    let fixture = graph();
    let not_a_graph = TempDir::new().unwrap();
    let output = reflect(
        &fixture,
        &["--graph", not_a_graph.path().to_str().unwrap(), "today"],
    );
    assert_eq!(output.status.code(), Some(1));
    assert!(stderr(&output).contains("not a Kore graph"));
}

#[test]
fn reflect_graph_env_var_resolves_the_graph() {
    let fixture = graph();
    let content = "via env\n";
    fixture.write_note(&daily_path(&today_date()), content);

    let elsewhere = TempDir::new().unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_reflect"))
        .args(["today"])
        .current_dir(elsewhere.path())
        .env("REFLECT_GRAPH", fixture.root())
        .output()
        .unwrap();
    assert!(output.status.success(), "stderr: {}", stderr(&output));
    assert_eq!(stdout(&output), content);
}

// ---- search -------------------------------------------------------------------

#[test]
fn search_ranks_hits_and_excludes_private_notes() {
    let fixture = graph();
    fixture.write_note(
        "notes/zebra.md",
        "# Zebra Migration\nzebra migration zebra migration details\n",
    );
    fixture.write_note("notes/other.md", "# Other\nmentions zebra once\n");
    fixture.write_note(
        "notes/secret.md",
        "---\nprivate: true\n---\n# Secret\nzebra zebra zebra\n",
    );
    fixture.build_index();

    let output = reflect(&fixture, &["search", "zebra"]);
    assert!(output.status.success(), "stderr: {}", stderr(&output));
    let text = stdout(&output);
    assert!(text.contains("notes/zebra.md"));
    assert!(text.contains("notes/other.md"));
    assert!(!text.contains("secret"));
    let zebra_pos = text.find("notes/zebra.md").unwrap();
    let other_pos = text.find("notes/other.md").unwrap();
    assert!(
        zebra_pos < other_pos,
        "expected zebra.md ranked first:\n{text}"
    );
}

/// Ranking parity with the desktop palette search (`filtered-search.ts`):
/// title hits are bm25-boosted 10× over body hits, so a title-only match must
/// outrank a body-only match.
#[test]
fn search_boosts_title_matches_over_body_matches() {
    let fixture = graph();
    fixture.write_note("notes/title-hit.md", "# Quokka Habitat\nnothing else\n");
    fixture.write_note(
        "notes/body-hit.md",
        "# Unrelated\na quokka appears mid-body\n",
    );
    fixture.build_index();

    let text = stdout(&reflect(&fixture, &["search", "quokka"]));
    let title_pos = text.find("notes/title-hit.md").unwrap();
    let body_pos = text.find("notes/body-hit.md").unwrap();
    assert!(
        title_pos < body_pos,
        "expected the title match ranked first:\n{text}"
    );
}

/// `unicode61` treats an uninterrupted Japanese title as one token. Search
/// therefore supplements MATCH with folded title-substring recall, including
/// common two-character queries that a trigram-only index would miss.
#[test]
fn search_finds_a_short_japanese_term_inside_a_title() {
    let fixture = graph();
    fixture.write_note(
        "notes/title-hit.md",
        "# 来週の東京旅行計画\nan otherwise unrelated body\n",
    );
    fixture.write_note(
        "notes/body-hit.md",
        "# 別のノート\nan otherwise unrelated 東京 body token\n",
    );
    fixture.build_index();

    let text = stdout(&reflect(&fixture, &["search", "東京"]));
    let title_pos = text.find("notes/title-hit.md").unwrap();
    let body_pos = text.find("notes/body-hit.md").unwrap();
    assert!(
        title_pos < body_pos,
        "expected the title substring match before the body match:\n{text}"
    );

    let multi_term = stdout(&reflect(&fixture, &["search", "東京 旅行"]));
    assert!(multi_term.contains("notes/title-hit.md"));
    assert!(!multi_term.contains("notes/body-hit.md"));
}

/// Title recall anchors space-delimited terms at word starts: `car` leads
/// with the title-prefix note, still returns the body match, and never
/// surfaces a mid-word title hit like `Oscar party plans`.
#[test]
fn search_matches_latin_title_terms_at_word_starts_only() {
    let fixture = graph();
    fixture.write_note(
        "notes/car-log.md",
        "# Car maintenance log\nan otherwise unrelated body\n",
    );
    fixture.write_note(
        "notes/oscar.md",
        "# Oscar party plans\nan otherwise unrelated body\n",
    );
    fixture.write_note("notes/garage.md", "# Garage\nthe car needs new brakes\n");
    fixture.build_index();

    let text = stdout(&reflect(&fixture, &["search", "car"]));
    let title_pos = text.find("notes/car-log.md").unwrap();
    let body_pos = text.find("notes/garage.md").unwrap();
    assert!(
        title_pos < body_pos,
        "expected the title-prefix match before the body match:\n{text}"
    );
    assert!(
        !text.contains("notes/oscar.md"),
        "a mid-word title substring must not match:\n{text}"
    );
}

/// Multi-term Latin title recall accepts a prefix of each word while keeping
/// title-only presentation independent of the lexical implementation.
#[test]
fn search_finds_a_multi_term_partial_latin_title() {
    let fixture = graph();
    fixture.write_note("notes/Tim MacCaw.md", "an otherwise unrelated body\n");
    fixture.build_index();

    let text = stdout(&reflect(&fixture, &["search", "Tim Mac"]));
    assert!(
        text.contains("notes/Tim MacCaw.md"),
        "expected the partial title match:\n{text}"
    );

    let value = json(&reflect(&fixture, &["search", "Tim Mac", "--json"]));
    assert_eq!(value["results"][0]["snippet"], "");
    assert_eq!(value["results"][0]["score"], 0.0);
}

#[test]
fn search_keeps_tokenizer_normalized_title_matches_above_body_matches() {
    let fixture = graph();
    fixture.write_note("notes/Café Alpha.md", "an otherwise unrelated body\n");
    fixture.write_note(
        "notes/body-hit.md",
        "# Unrelated note\na cafe appears here\n",
    );
    fixture.build_index();

    let value = json(&reflect(&fixture, &["search", "cafe", "--json"]));
    assert_eq!(value["results"][0]["path"], "notes/Café Alpha.md");
    assert_eq!(value["results"][0]["snippet"], "");
    assert!(value["results"][0]["score"].as_f64().unwrap() < 0.0);
    assert_eq!(value["results"][1]["path"], "notes/body-hit.md");
}

#[test]
fn search_breaks_title_prefix_ties_by_pinned_then_recency() {
    let fixture = graph();
    fixture.write_note(
        "notes/Tim MacCaw Extended Project Planning.md",
        "an otherwise unrelated body\n",
    );
    fixture.write_note("notes/Tim MacRae.md", "an otherwise unrelated body\n");
    fixture.build_index();

    let conn = rusqlite::Connection::open(fixture.root().join(".reflect/index.sqlite")).unwrap();
    conn.execute(
        "UPDATE notes SET mtime = 100, is_pinned = 1 WHERE path = 'notes/Tim MacCaw Extended Project Planning.md'",
        [],
    )
    .unwrap();
    conn.execute(
        "UPDATE notes SET mtime = 200, is_pinned = 0 WHERE path = 'notes/Tim MacRae.md'",
        [],
    )
    .unwrap();
    drop(conn);

    let text = stdout(&reflect(&fixture, &["search", "Tim Mac"]));
    let pinned_pos = text
        .find("notes/Tim MacCaw Extended Project Planning.md")
        .unwrap();
    let plain_pos = text.find("notes/Tim MacRae.md").unwrap();
    assert!(
        pinned_pos < plain_pos,
        "expected pinning to break the title-prefix tie:\n{text}"
    );
}

/// Body search uses the same word-prefix behavior as title recall, so users
/// get results while they are still typing each term.
#[test]
fn search_finds_partial_terms_in_note_bodies() {
    let fixture = graph();
    fixture.write_note(
        "notes/security-rollout.md",
        "# Security Rollout\nthe plan covers authentication migration\n",
    );
    fixture.build_index();

    let text = stdout(&reflect(&fixture, &["search", "authent migr"]));
    assert!(
        text.contains("notes/security-rollout.md"),
        "expected partial body terms to match:\n{text}"
    );

    let mixed = stdout(&reflect(&fixture, &["search", "secur migr"]));
    assert!(
        mixed.contains("notes/security-rollout.md"),
        "expected partial title and body terms to match together:\n{mixed}"
    );
}

/// A term of punctuation alone tokenizes to an empty FTS phrase, which would
/// empty the whole `AND` chain; it is dropped, while a query of nothing but
/// punctuation still matches nothing.
#[test]
fn search_ignores_terms_that_tokenize_to_nothing() {
    let fixture = graph();
    fixture.write_note(
        "notes/meeting-notes.md",
        "# Meeting Notes\nagenda items for the sync\n",
    );
    fixture.build_index();

    let text = stdout(&reflect(&fixture, &["search", "meeting - notes"]));
    assert!(
        text.contains("notes/meeting-notes.md"),
        "expected the punctuation term to be ignored:\n{text}"
    );

    let punctuation = stdout(&reflect(&fixture, &["search", ". -"]));
    assert!(
        !punctuation.contains("notes/meeting-notes.md"),
        "expected a punctuation-only query to match nothing:\n{punctuation}"
    );
}

/// The V1-style exact-title boost (`filtered-search.ts`): a note whose title
/// *is* the query ranks ahead of a louder lexical (bm25) match whose title only
/// contains the query among other words — exact title is promoted before bm25.
#[test]
fn search_promotes_exact_title_over_a_stronger_lexical_match() {
    let fixture = graph();
    fixture.write_note("notes/exact.md", "# Zebra\na single zebra\n");
    fixture.write_note(
        "notes/loud.md",
        "# Zebra Zebra Zebra Notes\nzebra zebra zebra zebra\n",
    );
    fixture.build_index();

    let text = stdout(&reflect(&fixture, &["search", "zebra"]));
    let exact_pos = text.find("notes/exact.md").unwrap();
    let loud_pos = text.find("notes/loud.md").unwrap();
    assert!(
        exact_pos < loud_pos,
        "expected the exact-title note ranked first:\n{text}"
    );
}

/// Pinned and recency are tiebreakers *after* exact-title and bm25 ordering:
/// two equally-ranked body hits order pinned-first, and pinned wins over a
/// newer mtime (mirrors the desktop's lexical ordering).
#[test]
fn search_breaks_ties_by_pinned_then_recency() {
    let fixture = graph();
    fixture.write_note("notes/older-pinned.md", "# Notes\napricot apricot\n");
    fixture.write_note("notes/newer-plain.md", "# Notes\napricot apricot\n");
    fixture.build_index();

    // Identical title + body → identical title-rank and bm25; only the
    // tiebreakers differ. Pin the older note: pinned must win over recency.
    let conn = rusqlite::Connection::open(fixture.root().join(".reflect/index.sqlite")).unwrap();
    conn.execute(
        "UPDATE notes SET mtime = 100, is_pinned = 1 WHERE path = 'notes/older-pinned.md'",
        [],
    )
    .unwrap();
    conn.execute(
        "UPDATE notes SET mtime = 200, is_pinned = 0 WHERE path = 'notes/newer-plain.md'",
        [],
    )
    .unwrap();
    drop(conn);

    let text = stdout(&reflect(&fixture, &["search", "apricot"]));
    let pinned_pos = text.find("notes/older-pinned.md").unwrap();
    let plain_pos = text.find("notes/newer-plain.md").unwrap();
    assert!(
        pinned_pos < plain_pos,
        "expected the pinned note ranked before the newer unpinned note:\n{text}"
    );
}

#[test]
fn search_without_an_index_exits_4() {
    let fixture = graph();
    fixture.write_note("notes/a.md", "anything\n");
    let output = reflect(&fixture, &["search", "anything"]);
    assert_eq!(output.status.code(), Some(4));
    assert!(stderr(&output).contains("no search index"));
}

#[test]
fn search_warns_when_the_index_is_stale_but_still_returns_rows() {
    let fixture = graph();
    fixture.write_note("notes/a.md", "alpha content here\n");
    fixture.build_index();
    // An external edit after indexing: same mtime gate can't catch everything,
    // so force divergence (older mtime in the index row + different hash).
    let conn = rusqlite::Connection::open(fixture.root().join(".reflect/index.sqlite")).unwrap();
    conn.execute("UPDATE notes SET mtime = 1, file_hash = 'stale'", [])
        .unwrap();
    drop(conn);

    let output = reflect(&fixture, &["search", "alpha"]);
    assert!(output.status.success());
    assert!(stderr(&output).contains("stale"));
    assert!(stdout(&output).contains("notes/a.md"));

    let value = json(&reflect(&fixture, &["search", "alpha", "--json"]));
    assert_eq!(value["stale"], true);
}

#[test]
fn search_fails_closed_when_an_indexed_note_is_unavailable() {
    let fixture = graph();
    let note = fixture.write_note("Projects/plan.md", "# Plan\nsecret searchable text\n");
    fixture.build_index();
    fs::remove_file(note).unwrap();
    fs::write(
        fixture.root().join("Projects/.plan.md.icloud"),
        b"placeholder",
    )
    .unwrap();

    let output = reflect(&fixture, &["search", "searchable"]);
    assert!(output.status.success(), "stderr: {}", stderr(&output));
    assert_eq!(stdout(&output), "");
}

#[cfg(unix)]
#[test]
fn stale_index_never_follows_a_note_replaced_by_a_symlink() {
    use std::os::unix::fs::symlink;

    let fixture = graph();
    let note = fixture.write_note("Projects/plan.md", "# Plan\nindexed text\n");
    fixture.build_index();
    let outside = tempfile::NamedTempFile::new().unwrap();
    fs::write(outside.path(), "outside secret\n").unwrap();
    fs::remove_file(note).unwrap();
    symlink(outside.path(), fixture.root().join("Projects/plan.md")).unwrap();

    let show = reflect(&fixture, &["show", "Plan"]);
    assert!(!show.status.success());
    assert!(!stdout(&show).contains("outside secret"));

    let search = reflect(&fixture, &["search", "indexed"]);
    assert!(search.status.success(), "stderr: {}", stderr(&search));
    assert_eq!(stdout(&search), "");
}

#[test]
fn search_json_shape() {
    let fixture = graph();
    fixture.write_note("notes/a.md", "# Alpha\nsearchable text\n");
    fixture.build_index();

    let value = json(&reflect(&fixture, &["search", "searchable", "--json"]));
    assert_eq!(value["query"], "searchable");
    assert_eq!(value["stale"], false);
    let results = value["results"].as_array().unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0]["path"], "notes/a.md");
    assert_eq!(results[0]["title"], "Alpha");
    assert!(results[0]["snippet"]
        .as_str()
        .unwrap()
        .contains("searchable"));
    assert!(results[0]["score"].is_number());
}

#[test]
fn search_drops_a_note_flagged_private_after_indexing() {
    let fixture = graph();
    let note = fixture.write_note("notes/a.md", "# Alpha\nsearchable text\n");
    fixture.build_index();
    fs::write(&note, "---\nprivate: true\n---\n# Alpha\nsearchable text\n").unwrap();

    let output = reflect(&fixture, &["search", "searchable"]);
    assert!(output.status.success());
    assert_eq!(stdout(&output), "", "a just-flagged note must not surface");
}

// ---- show / path ----------------------------------------------------------------

#[test]
fn show_resolves_by_title_alias_date_and_path() {
    let fixture = graph();
    fixture.write_note(
        "notes/project-x.md",
        "---\naliases: [PX]\n---\n# Project X\nthe plan\n",
    );
    fixture.write_note("daily/2026-01-02.md", "daily body\n");
    fixture.build_index();

    for arg in ["Project X", "project x", "PX", "notes/project-x.md"] {
        let output = reflect(&fixture, &["show", arg]);
        assert!(output.status.success(), "show {arg}: {}", stderr(&output));
        assert!(stdout(&output).contains("the plan"), "show {arg}");
    }
    let by_date = reflect(&fixture, &["show", "2026-01-02"]);
    assert_eq!(stdout(&by_date), "daily body\n");

    let missing_daily = reflect(&fixture, &["show", "2026-01-03"]);
    assert_eq!(missing_daily.status.code(), Some(3));

    let unknown = reflect(&fixture, &["show", "No Such Note"]);
    assert_eq!(unknown.status.code(), Some(3));
    assert!(stderr(&unknown).contains("no note matching"));
}

#[test]
fn show_resolves_by_title_and_alias_without_an_index() {
    let fixture = graph();
    fixture.write_note(
        "notes/project-x.md",
        "---\naliases: [PX]\n---\n# Project X\nthe plan\n",
    );

    for arg in ["project x", "PX"] {
        let output = reflect(&fixture, &["show", arg]);
        assert!(output.status.success(), "show {arg}: {}", stderr(&output));
        assert!(stdout(&output).contains("the plan"));
    }
}

#[test]
fn show_blocks_a_private_note_even_when_the_index_says_public() {
    let fixture = graph();
    let note = fixture.write_note("notes/a.md", "# Alpha\npublic at index time\n");
    fixture.build_index();
    fs::write(&note, "---\nprivate: true\n---\n# Alpha\nnow secret\n").unwrap();

    let output = reflect(&fixture, &["show", "Alpha"]);
    assert_eq!(output.status.code(), Some(3));
    assert_eq!(stdout(&output), "");
    assert!(stderr(&output).contains("private"));

    let path_output = reflect(&fixture, &["path", "Alpha"]);
    assert_eq!(path_output.status.code(), Some(3));
}

#[test]
fn show_json_includes_the_daily_date() {
    let fixture = graph();
    fixture.write_note("daily/2026-01-02.md", "daily body\n");

    let value = json(&reflect(&fixture, &["show", "2026-01-02", "--json"]));
    assert_eq!(value["date"], "2026-01-02");
    assert_eq!(value["path"], "daily/2026-01-02.md");
    assert_eq!(value["title"], "2026-01-02");
    assert_eq!(value["content"], "daily body\n");
}

#[test]
fn path_resolves_notes_and_would_be_dailies() {
    let fixture = graph();
    fixture.write_note("notes/project-x.md", "# Project X\n");
    fixture.build_index();

    let by_title = reflect(&fixture, &["path", "Project X"]);
    assert!(by_title.status.success());
    assert!(stdout(&by_title).trim_end().ends_with("notes/project-x.md"));

    let value = json(&reflect(&fixture, &["path", "2099-01-01", "--json"]));
    assert_eq!(value["date"], "2099-01-01");
    assert_eq!(value["path"], "daily/2099-01-01.md");
    assert_eq!(value["exists"], false);

    let existing = json(&reflect(
        &fixture,
        &["path", "notes/project-x.md", "--json"],
    ));
    assert_eq!(existing["exists"], true);
    assert!(existing.get("date").is_none());
}

// ---- open -----------------------------------------------------------------------

#[test]
fn open_print_prefers_the_frontmatter_id() {
    let fixture = graph();
    fixture.write_note(
        "notes/project-x.md",
        "---\nid: 01hzy3v9k2m4n6p8q0r2s4t6vw\n---\n# Project X\n",
    );
    fixture.build_index();

    let output = reflect(&fixture, &["open", "Project X", "--print"]);
    assert!(output.status.success(), "stderr: {}", stderr(&output));
    assert_eq!(
        stdout(&output),
        "reflect://note/01hzy3v9k2m4n6p8q0r2s4t6vw\n"
    );
}

#[test]
fn open_print_falls_back_to_the_encoded_path_without_an_id() {
    let fixture = graph();
    fixture.write_note("notes/no id here.md", "# No Id Here\n");
    fixture.build_index();

    let output = reflect(&fixture, &["open", "No Id Here", "--print"]);
    assert!(output.status.success(), "stderr: {}", stderr(&output));
    assert_eq!(
        stdout(&output),
        "reflect://note/notes%2Fno%20id%20here.md\n"
    );
}

#[test]
fn open_print_gives_dailies_the_date_form_even_before_the_file_exists() {
    let fixture = graph();

    let would_be = reflect(&fixture, &["open", "2099-01-01", "--print"]);
    assert!(would_be.status.success(), "stderr: {}", stderr(&would_be));
    assert_eq!(stdout(&would_be), "reflect://daily/2099-01-01\n");

    // An existing daily resolved by explicit path gets the date form too.
    fixture.write_note("daily/2026-01-02.md", "daily body\n");
    let by_path = reflect(&fixture, &["open", "daily/2026-01-02.md", "--print"]);
    assert_eq!(stdout(&by_path), "reflect://daily/2026-01-02\n");
}

#[test]
fn open_resolves_by_title_and_alias_without_an_index() {
    let fixture = graph();
    fixture.write_note(
        "notes/project-x.md",
        "---\nid: 01hzy3v9k2m4n6p8q0r2s4t6vw\naliases: [PX]\n---\n# Project X\n",
    );

    for arg in ["project x", "PX"] {
        let output = reflect(&fixture, &["open", arg, "--print"]);
        assert!(output.status.success(), "open {arg}: {}", stderr(&output));
        assert_eq!(
            stdout(&output),
            "reflect://note/01hzy3v9k2m4n6p8q0r2s4t6vw\n",
            "open {arg}"
        );
    }
}

#[test]
fn open_refuses_private_notes_and_unknown_targets() {
    let fixture = graph();
    fixture.write_note("notes/a.md", "---\nprivate: true\n---\n# Alpha\n");
    fixture.build_index();

    let private = reflect(&fixture, &["open", "notes/a.md", "--print"]);
    assert_eq!(private.status.code(), Some(3));
    assert_eq!(
        stdout(&private),
        "",
        "a private note's address must not leak"
    );
    assert!(stderr(&private).contains("private"));

    let unknown = reflect(&fixture, &["open", "No Such Note", "--print"]);
    assert_eq!(unknown.status.code(), Some(3));
    assert!(stderr(&unknown).contains("no note matching"));
}

#[test]
fn open_json_shape() {
    let fixture = graph();
    fixture.write_note(
        "notes/project-x.md",
        "---\nid: 01hzy3v9k2m4n6p8q0r2s4t6vw\n---\n# Project X\n",
    );
    fixture.build_index();

    let note = json(&reflect(
        &fixture,
        &["open", "Project X", "--print", "--json"],
    ));
    assert_eq!(note["path"], "notes/project-x.md");
    assert_eq!(note["url"], "reflect://note/01hzy3v9k2m4n6p8q0r2s4t6vw");
    assert_eq!(note["launched"], false);
    assert!(note.get("date").is_none());

    let daily = json(&reflect(
        &fixture,
        &["open", "2026-01-02", "--json", "--print"],
    ));
    assert_eq!(daily["date"], "2026-01-02");
    assert_eq!(daily["path"], "daily/2026-01-02.md");
    assert_eq!(daily["url"], "reflect://daily/2026-01-02");
}

#[test]
fn show_resolves_a_note_by_its_filename_stem() {
    // The H1 differs from the filename: Obsidian's convention. Both spellings
    // must resolve, with or without an index.
    let fixture = graph();
    fixture.write_note("Projects/Plan.md", "# Weekly Planning\nstem body\n");

    let by_stem = reflect(&fixture, &["show", "Plan"]);
    assert!(by_stem.status.success(), "{}", stderr(&by_stem));
    assert!(stdout(&by_stem).contains("stem body"));

    fixture.build_index();
    let indexed = reflect(&fixture, &["show", "Plan"]);
    assert!(indexed.status.success(), "{}", stderr(&indexed));
    assert!(stdout(&indexed).contains("stem body"));
}

#[test]
fn show_prefers_a_title_over_a_filename_stem() {
    let fixture = graph();
    fixture.write_note("Archive/old.md", "# Plan\ntitled body\n");
    fixture.write_note("Projects/Plan.md", "# Weekly Planning\nstem body\n");

    let scanned = reflect(&fixture, &["show", "Plan"]);
    assert!(scanned.status.success(), "{}", stderr(&scanned));
    assert!(stdout(&scanned).contains("titled body"));

    fixture.build_index();
    let indexed = reflect(&fixture, &["show", "Plan"]);
    assert!(indexed.status.success(), "{}", stderr(&indexed));
    assert!(stdout(&indexed).contains("titled body"));
}

#[test]
fn show_resolves_a_nested_vault_path_argument() {
    let fixture = graph();
    fixture.write_note("Projects/deep/Plan.md", "# Anything\nnested body\n");

    let output = reflect(&fixture, &["show", "Projects/deep/Plan.md"]);
    assert!(output.status.success(), "{}", stderr(&output));
    assert!(stdout(&output).contains("nested body"));
}

#[test]
fn scan_resolution_agrees_with_the_index_on_stems() {
    // The same vault answers the same way whether or not `.reflect` has an
    // index — the parity commit 4 exists to keep.
    let fixture = graph();
    fixture.write_note("a/Plan.md", "# One Thing\nfirst body\n");
    fixture.write_note("b/Plan.md", "# Another Thing\nsecond body\n");

    let scanned = reflect(&fixture, &["path", "Plan"]);
    assert!(scanned.status.success(), "{}", stderr(&scanned));
    let scanned_path = stdout(&scanned);

    fixture.build_index();
    let indexed = reflect(&fixture, &["path", "Plan"]);
    assert!(indexed.status.success(), "{}", stderr(&indexed));
    assert_eq!(stdout(&indexed), scanned_path);
    assert!(scanned_path.contains("a/Plan.md"));
}

// ---- tasks ------------------------------------------------------------------

impl Fixture {
    /// Insert one task row the way the desktop projection would.
    fn insert_task(
        &self,
        rel_path: &str,
        offset: i64,
        text: &str,
        checked: bool,
        due: Option<&str>,
        due_time: Option<&str>,
    ) {
        let conn =
            rusqlite::Connection::open(self.root().join(".reflect").join("index.sqlite")).unwrap();
        conn.execute(
            "INSERT INTO tasks(note_path, marker_offset, text, raw, checked, due_date, due_time)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                rel_path,
                offset,
                text,
                format!("[ ] {text}"),
                i64::from(checked),
                due,
                due_time
            ],
        )
        .unwrap();
    }
}

#[test]
fn tasks_lists_open_tasks_and_excludes_private_notes() {
    let fixture = graph();
    fixture.write_note(
        "notes/project.md",
        "# Project X\n+ [ ] pay bill\n+ [x] done\n",
    );
    fixture.write_note(
        "notes/secret.md",
        "---\nprivate: true\n---\n# Secret\n+ [ ] hidden task\n",
    );
    fixture.build_index();
    fixture.insert_task(
        "notes/project.md",
        12,
        "pay bill",
        false,
        Some("2026-08-22"),
        None,
    );
    fixture.insert_task("notes/project.md", 27, "done", true, None, None);
    fixture.insert_task("notes/secret.md", 30, "hidden task", false, None, None);

    let value = json(&reflect(&fixture, &["tasks", "--json"]));
    let tasks = value["tasks"].as_array().unwrap();
    assert_eq!(tasks.len(), 1, "only the public open task: {value}");
    assert_eq!(tasks[0]["path"], "notes/project.md");
    assert_eq!(tasks[0]["title"], "Project X");
    assert_eq!(tasks[0]["text"], "pay bill");
    assert_eq!(tasks[0]["checked"], false);
    assert_eq!(tasks[0]["dueDate"], "2026-08-22");

    let all = json(&reflect(&fixture, &["tasks", "--all", "--json"]));
    assert_eq!(all["tasks"].as_array().unwrap().len(), 2);

    let human = reflect(&fixture, &["tasks"]);
    assert!(human.status.success());
    let text = stdout(&human);
    assert!(text.contains("notes/project.md\tProject X"));
    assert!(text.contains("  [ ] pay bill  (due 2026-08-22)"));
    assert!(!text.contains("hidden task"));
}

#[test]
fn tasks_includes_a_due_time_when_the_row_has_one() {
    let fixture = graph();
    fixture.write_note("notes/project.md", "# Project X\n+ [ ] dentist\n");
    fixture.build_index();
    fixture.insert_task(
        "notes/project.md",
        12,
        "dentist",
        false,
        Some("2026-08-22"),
        Some("14:30"),
    );

    let value = json(&reflect(&fixture, &["tasks", "--json"]));
    let tasks = value["tasks"].as_array().unwrap();
    assert_eq!(tasks.len(), 1, "only the timed task: {value}");
    assert_eq!(tasks[0]["dueDate"], "2026-08-22");
    assert_eq!(tasks[0]["dueTime"], "14:30");

    let human = reflect(&fixture, &["tasks"]);
    assert!(human.status.success());
    assert!(stdout(&human).contains("  [ ] dentist  (due 2026-08-22 14:30)"));
}

#[test]
fn tasks_without_an_index_exits_4() {
    let fixture = graph();
    let output = reflect(&fixture, &["tasks"]);
    assert_eq!(output.status.code(), Some(4));
    assert!(stderr(&output).contains("open this graph in Kore"));
}

// ---- capture ----------------------------------------------------------------

#[test]
fn capture_joins_todays_trailing_list() {
    let fixture = graph();
    let rel_path = daily_path(&today_date());
    let absolute = fixture.write_note(&rel_path, "# Plans\n\n- one\n");

    let output = reflect(&fixture, &["capture", "two"]);
    assert!(output.status.success(), "stderr: {}", stderr(&output));
    assert_eq!(stdout(&output).trim_end(), absolute.display().to_string());
    assert_eq!(
        fs::read_to_string(&absolute).unwrap(),
        "# Plans\n\n- one\n- two\n"
    );
}

#[test]
fn capture_task_creates_the_daily_and_reports_json() {
    let fixture = graph();
    let value = json(&reflect(
        &fixture,
        &["capture", "--task", "Pay bill", "--json"],
    ));
    assert_eq!(value["date"], today_date());
    assert_eq!(value["path"], daily_path(&today_date()));
    assert_eq!(value["created"], true);
    assert_eq!(value["item"], "+ [ ] Pay bill");

    let absolute = fixture.root().join(daily_path(&today_date()));
    assert_eq!(fs::read_to_string(absolute).unwrap(), "+ [ ] Pay bill\n");
}

#[test]
fn capture_refuses_a_private_daily() {
    let fixture = graph();
    let rel_path = daily_path(&today_date());
    let content = "---\nprivate: true\n---\nsecret plans\n";
    let absolute = fixture.write_note(&rel_path, content);

    let output = reflect(&fixture, &["capture", "never lands"]);
    assert_eq!(output.status.code(), Some(3));
    assert!(stderr(&output).contains("private"));
    assert_eq!(fs::read_to_string(absolute).unwrap(), content);
}

#[test]
fn capture_rejects_empty_text_and_collapses_line_breaks() {
    let fixture = graph();
    let empty = reflect(&fixture, &["capture", "  \n  "]);
    assert_eq!(empty.status.code(), Some(1));

    let output = reflect(&fixture, &["capture", "line one\nline two"]);
    assert!(output.status.success(), "stderr: {}", stderr(&output));
    let absolute = fixture.root().join(daily_path(&today_date()));
    assert_eq!(
        fs::read_to_string(absolute).unwrap(),
        "- line one line two\n"
    );
}

// ---- backlinks --------------------------------------------------------------

impl Fixture {
    /// Insert one wiki link the way the desktop projection would.
    fn insert_wiki_link(&self, source: &str, target_title: &str, pos: i64) {
        let conn =
            rusqlite::Connection::open(self.root().join(".reflect").join("index.sqlite")).unwrap();
        conn.execute(
            "INSERT INTO links(source_path, kind, target_raw, target_key, alias,
                               pos_from, pos_to, target_path_key)
             VALUES(?1, 'wiki', ?2, ?3, NULL, ?4, ?4, NULL)",
            params![source, target_title, fold_key(target_title), pos],
        )
        .unwrap();
    }
}

#[test]
fn backlinks_lists_linking_notes_and_excludes_private_sources() {
    let fixture = graph();
    fixture.write_note("notes/target.md", "# Target\nbody\n");
    fixture.write_note("notes/a.md", "# A\nsee [[Target]]\n");
    fixture.write_note("notes/b.md", "# B\n[[Target]] and [[Target]] again\n");
    fixture.write_note(
        "notes/secret.md",
        "---\nprivate: true\n---\n# Secret\n[[Target]]\n",
    );
    fixture.build_index();
    fixture.insert_wiki_link("notes/a.md", "Target", 10);
    fixture.insert_wiki_link("notes/b.md", "Target", 4);
    fixture.insert_wiki_link("notes/b.md", "Target", 20);
    fixture.insert_wiki_link("notes/secret.md", "Target", 12);

    let value = json(&reflect(&fixture, &["backlinks", "Target", "--json"]));
    assert_eq!(value["path"], "notes/target.md");
    assert_eq!(value["title"], "Target");
    let backlinks = value["backlinks"].as_array().unwrap();
    assert_eq!(backlinks.len(), 2, "private source excluded: {value}");
    assert_eq!(backlinks[0]["path"], "notes/a.md");
    assert_eq!(backlinks[0]["count"], 1);
    assert_eq!(backlinks[1]["path"], "notes/b.md");
    assert_eq!(backlinks[1]["count"], 2);

    let human = reflect(&fixture, &["backlinks", "Target"]);
    assert!(human.status.success());
    assert!(stdout(&human).contains("notes/b.md\tB\t(2 links)"));
    assert!(!stdout(&human).contains("secret"));
}

#[test]
fn backlinks_refuses_a_private_target_and_needs_the_index() {
    let fixture = graph();
    let no_index = reflect(&fixture, &["backlinks", "Anything"]);
    assert_eq!(no_index.status.code(), Some(4));

    fixture.write_note(
        "notes/secret.md",
        "---\nprivate: true\n---\n# Secret\nbody\n",
    );
    fixture.build_index();
    let output = reflect(&fixture, &["backlinks", "notes/secret.md"]);
    assert_eq!(output.status.code(), Some(3));
    assert!(stderr(&output).contains("private"));
}

// ---- recent -----------------------------------------------------------------

#[test]
fn recent_lists_newest_public_notes_first() {
    let fixture = graph();
    fixture.write_note("notes/old.md", "# Old\nbody\n");
    fixture.write_note("notes/fresh.md", "# Fresh\nbody\n");
    fixture.write_note(
        "notes/secret.md",
        "---\nprivate: true\n---\n# Secret\nbody\n",
    );
    fixture.write_note("templates/journal.md", "# Journal\nMood:\n");
    fixture.build_index();
    let conn =
        rusqlite::Connection::open(fixture.root().join(".reflect").join("index.sqlite")).unwrap();
    for (path, updated) in [
        ("notes/old.md", 1_000_i64),
        ("notes/fresh.md", 2_000),
        ("notes/secret.md", 3_000),
    ] {
        conn.execute(
            "UPDATE notes SET updated_at = ?2 WHERE path = ?1",
            params![path, updated],
        )
        .unwrap();
    }
    conn.execute(
        "UPDATE notes SET kind = 'template' WHERE path = 'templates/journal.md'",
        [],
    )
    .unwrap();
    drop(conn);

    let value = json(&reflect(&fixture, &["recent", "--json"]));
    let notes = value["notes"].as_array().unwrap();
    assert_eq!(notes.len(), 2, "private + template excluded: {value}");
    assert_eq!(notes[0]["path"], "notes/fresh.md");
    assert_eq!(notes[1]["path"], "notes/old.md");
    assert!(notes[0]["updatedAt"]
        .as_str()
        .unwrap()
        .starts_with("1970-01-01T"));

    let limited = json(&reflect(&fixture, &["recent", "--limit", "1", "--json"]));
    assert_eq!(limited["notes"].as_array().unwrap().len(), 1);
}

// ---- collection -------------------------------------------------------------

#[test]
fn collection_lists_typed_tag_rows_with_properties() {
    let fixture = graph();
    fixture.write_note(
        "notes/dispossessed.md",
        "---\nauthor: Le Guin\nrating: 4.5\n---\n# The Dispossessed\n#book\n",
    );
    fixture.write_note(
        "notes/dune.md",
        "---\nauthor: Herbert\n---\n# Dune\n#book\n",
    );
    fixture.write_note(
        "notes/secret.md",
        "---\nprivate: true\nauthor: Nobody\n---\n# Secret\n#book\n",
    );
    fixture.build_index();
    let conn =
        rusqlite::Connection::open(fixture.root().join(".reflect").join("index.sqlite")).unwrap();
    // Mirror the desktop projection: tag rows, the tag's type, property rows.
    for path in ["notes/dispossessed.md", "notes/dune.md", "notes/secret.md"] {
        conn.execute(
            "INSERT INTO tags(note_path, tag, tag_key) VALUES(?1, 'book', 'book')",
            params![path],
        )
        .unwrap();
    }
    conn.execute(
        "INSERT INTO notes(path, id, title, title_key, kind, is_private, is_pinned,
                           file_hash, mtime, updated_at, preview)
         VALUES('tags/book.md', 'tag-book', 'book', 'book', 'tag', 0, 0, 'x', 0, 0, '')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO tag_types(tag_key, note_path, schema_json)
         VALUES('book', 'tags/book.md',
                '[{\"name\":\"Author\",\"key\":\"author\",\"type\":\"text\"},{\"name\":\"Rating\",\"key\":\"rating\",\"type\":\"number\"}]')",
        [],
    )
    .unwrap();
    for (path, key, value, value_type, value_number) in [
        (
            "notes/dispossessed.md",
            "author",
            "Le Guin",
            "string",
            None::<f64>,
        ),
        (
            "notes/dispossessed.md",
            "rating",
            "4.5",
            "number",
            Some(4.5),
        ),
        ("notes/dune.md", "author", "Herbert", "string", None),
        ("notes/secret.md", "author", "Nobody", "string", None),
    ] {
        conn.execute(
            "INSERT INTO note_properties(note_path, key, value, value_type, value_number)
             VALUES(?1, ?2, ?3, ?4, ?5)",
            params![path, key, value, value_type, value_number],
        )
        .unwrap();
    }
    drop(conn);

    let value = json(&reflect(&fixture, &["collection", "Book", "--json"]));
    assert_eq!(value["tag"], "Book");
    let schema = value["schema"].as_array().unwrap();
    assert_eq!(schema.len(), 2);
    assert_eq!(schema[0]["key"], "author");
    assert_eq!(schema[1]["type"], "number");
    let notes = value["notes"].as_array().unwrap();
    assert_eq!(notes.len(), 2, "private row excluded entirely: {value}");
    let payload = value.to_string();
    assert!(!payload.contains("secret"), "private leak: {payload}");
    assert!(!payload.contains("Nobody"), "private value leak: {payload}");
    let dispossessed = notes
        .iter()
        .find(|note| note["path"] == "notes/dispossessed.md")
        .unwrap();
    assert_eq!(dispossessed["properties"]["author"], "Le Guin");
    assert_eq!(dispossessed["properties"]["rating"], 4.5);

    // A property sort orders by the stored value, missing values last.
    let sorted = json(&reflect(
        &fixture,
        &["collection", "book", "--sort", "rating", "--json"],
    ));
    let sorted_notes = sorted["notes"].as_array().unwrap();
    assert_eq!(sorted_notes[0]["path"], "notes/dispossessed.md");
    assert_eq!(sorted_notes[1]["path"], "notes/dune.md");
}

#[test]
fn collection_refuses_untyped_tags_and_requires_the_index() {
    let fixture = graph();
    fixture.write_note("notes/a.md", "# A\n#plain\n");
    let missing = reflect(&fixture, &["collection", "plain"]);
    assert_eq!(missing.status.code(), Some(4), "no index yet");

    fixture.build_index();
    let untyped = reflect(&fixture, &["collection", "plain"]);
    assert_eq!(untyped.status.code(), Some(3));
    assert!(stderr(&untyped).contains("no type"));
}

// ---- new --------------------------------------------------------------------

#[test]
fn new_creates_titled_notes_with_collision_suffixes() {
    let fixture = graph();
    let value = json(&reflect(&fixture, &["new", "Meeting Notes!", "--json"]));
    assert_eq!(value["path"], "notes/meeting-notes.md");
    assert_eq!(value["title"], "Meeting Notes!");
    assert_eq!(
        fs::read_to_string(fixture.root().join("notes/meeting-notes.md")).unwrap(),
        "# Meeting Notes!\n"
    );

    let second = json(&reflect(&fixture, &["new", "Meeting Notes!", "--json"]));
    assert_eq!(second["path"], "notes/meeting-notes-2.md");

    let human = reflect(&fixture, &["new", "Other"]);
    assert!(human.status.success());
    assert!(stdout(&human).trim_end().ends_with("notes/other.md"));
}

#[test]
fn new_seeds_from_a_template_with_placeholders_expanded() {
    let fixture = graph();
    fixture.write_note(
        "templates/journal.md",
        "---\ncolor: blue\n---\n# {{title}} — {{date:iso}}\n\nMood:\n",
    );
    let value = json(&reflect(
        &fixture,
        &["new", "Aug Journal", "--template", "journal", "--json"],
    ));
    assert_eq!(value["path"], "notes/aug-journal.md");
    let content = fs::read_to_string(fixture.root().join("notes/aug-journal.md")).unwrap();
    assert_eq!(
        content,
        format!("# Aug Journal — {}\n\nMood:\n", today_date())
    );

    // A template without its own H1 gets the title prepended.
    fixture.write_note("templates/plain.md", "Mood:\n");
    reflect(&fixture, &["new", "Plain One", "--template", "plain"]);
    assert_eq!(
        fs::read_to_string(fixture.root().join("notes/plain-one.md")).unwrap(),
        "# Plain One\n\nMood:\n"
    );

    let missing = reflect(&fixture, &["new", "X", "--template", "nope"]);
    assert_eq!(missing.status.code(), Some(3));

    fixture.write_note(
        "templates/hidden.md",
        "---\nprivate: true\n---\nsecret seed\n",
    );
    let private = reflect(&fixture, &["new", "Y", "--template", "hidden"]);
    assert_eq!(private.status.code(), Some(3));
    assert!(stderr(&private).contains("private"));
}

// ---- capture --to -----------------------------------------------------------

#[test]
fn capture_to_resolves_titles_dates_and_refuses_private_targets() {
    let fixture = graph();
    fixture.write_note("notes/project.md", "# Project X\n\n- one\n");
    fixture.write_note(
        "notes/secret.md",
        "---\nprivate: true\n---\n# Secret\nbody\n",
    );

    let value = json(&reflect(
        &fixture,
        &["capture", "two", "--to", "Project X", "--json"],
    ));
    assert_eq!(value["path"], "notes/project.md");
    assert!(
        value.get("date").is_none(),
        "no date for a regular note: {value}"
    );
    assert_eq!(
        fs::read_to_string(fixture.root().join("notes/project.md")).unwrap(),
        "# Project X\n\n- one\n- two\n"
    );

    // A date target is a lazy daily: capture creates it.
    let dated = json(&reflect(
        &fixture,
        &["capture", "plan ahead", "--to", "2099-01-02", "--json"],
    ));
    assert_eq!(dated["date"], "2099-01-02");
    assert_eq!(dated["created"], true);
    assert_eq!(
        fs::read_to_string(fixture.root().join("daily/2099-01-02.md")).unwrap(),
        "- plan ahead\n"
    );

    let private = reflect(&fixture, &["capture", "x", "--to", "Secret"]);
    assert_eq!(private.status.code(), Some(3));

    let unknown = reflect(&fixture, &["capture", "x", "--to", "No Such Note"]);
    assert_eq!(unknown.status.code(), Some(3));
}

// ---- Plan 30: discovery ------------------------------------------------------

impl Fixture {
    fn index_conn(&self) -> rusqlite::Connection {
        rusqlite::Connection::open(self.root().join(".reflect").join("index.sqlite")).unwrap()
    }

    /// Mirror the desktop's tag projection: one row per tag occurrence.
    fn insert_tag(&self, rel_path: &str, tag: &str) {
        self.index_conn()
            .execute(
                "INSERT INTO tags(note_path, tag, tag_key) VALUES(?1, ?2, ?3)",
                params![rel_path, tag, tag.to_lowercase()],
            )
            .unwrap();
    }

    /// A typed tag: its definition note row plus the `tag_types` schema.
    fn insert_tag_type(&self, tag: &str, schema_json: &str) {
        let conn = self.index_conn();
        let path = format!("tags/{tag}.md");
        conn.execute(
            "INSERT OR IGNORE INTO notes(path, id, title, title_key, kind, is_private, is_pinned,
                                         file_hash, mtime, updated_at, preview)
             VALUES(?1, ?2, ?3, ?3, 'tag', 0, 0, 'x', 0, 0, '')",
            params![path, format!("tag-{tag}"), tag],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tag_types(tag_key, note_path, schema_json) VALUES(?1, ?2, ?3)",
            params![tag.to_lowercase(), path, schema_json],
        )
        .unwrap();
    }

    /// One outgoing wiki link, the way the desktop projects `[[target]]`.
    fn insert_link(&self, source: &str, target: &str, position: i64) {
        self.index_conn()
            .execute(
                "INSERT INTO links(source_path, kind, target_raw, target_key, alias, pos_from, pos_to)
                 VALUES(?1, 'wiki', ?2, ?3, NULL, ?4, ?4)",
                params![source, target, fold_key(target), position],
            )
            .unwrap();
    }

    fn set_updated(&self, rel_path: &str, updated_ms: i64) {
        self.index_conn()
            .execute(
                "UPDATE notes SET updated_at = ?2 WHERE path = ?1",
                params![rel_path, updated_ms],
            )
            .unwrap();
    }
}

#[test]
fn info_reports_the_missing_index_then_counts_once_built() {
    let fixture = graph();
    fixture.write_note("notes/a.md", "# A\n#idea\n");
    fixture.write_note("daily/2026-06-11.md", "- day\n");
    fixture.write_note("notes/secret.md", "---\nprivate: true\n---\n# S\n#idea\n");

    let before = reflect(&fixture, &["info", "--json"]);
    assert_eq!(before.status.code(), Some(0), "info never needs the index");
    let value = json(&before);
    assert_eq!(value["index"]["present"], false);
    assert!(value["counts"].is_null());
    assert_eq!(value["cliVersion"], env!("CARGO_PKG_VERSION"));

    fixture.build_index();
    fixture.insert_tag("notes/a.md", "idea");
    fixture.insert_tag("notes/secret.md", "idea");
    let value = json(&reflect(&fixture, &["info", "--json"]));
    assert_eq!(value["index"]["present"], true);
    assert_eq!(value["index"]["usable"], true);
    assert_eq!(value["index"]["stale"], false);
    assert_eq!(value["counts"]["notes"], 1, "private note not counted");
    assert_eq!(value["counts"]["dailies"], 1);
    assert_eq!(value["counts"]["tags"], 1);

    let human = stdout(&reflect(&fixture, &["info"]));
    assert!(human.contains("index\tfresh"), "{human}");
}

#[test]
fn tags_lists_counts_and_typed_flags_excluding_private_notes() {
    let fixture = graph();
    fixture.write_note("notes/dune.md", "# Dune\n#Book\n");
    fixture.write_note("notes/emma.md", "# Emma\n#book #idea\n");
    fixture.write_note("notes/secret.md", "---\nprivate: true\n---\n# S\n#book\n");
    let missing = reflect(&fixture, &["tags"]);
    assert_eq!(missing.status.code(), Some(4));

    fixture.build_index();
    fixture.insert_tag("notes/dune.md", "Book");
    fixture.insert_tag("notes/emma.md", "book");
    fixture.insert_tag("notes/emma.md", "idea");
    fixture.insert_tag("notes/secret.md", "book");
    fixture.insert_tag_type(
        "book",
        r#"[{"name":"Author","key":"author","type":"text"}]"#,
    );

    let value = json(&reflect(&fixture, &["tags", "--json"]));
    let tags = value["tags"].as_array().unwrap();
    assert_eq!(tags.len(), 2);
    assert_eq!(
        tags[0]["tag"], "Book",
        "one display casing per key: {value}"
    );
    assert_eq!(tags[0]["count"], 2, "private row not counted");
    assert_eq!(tags[0]["typed"], true);
    assert_eq!(tags[0]["definition"], "tags/book.md");
    assert_eq!(tags[1]["tag"], "idea");
    assert_eq!(tags[1]["typed"], false);
    assert!(tags[1]["definition"].is_null());

    let human = stdout(&reflect(&fixture, &["tags"]));
    assert!(human.contains("#Book\t2\tcollection"), "{human}");
}

#[test]
fn list_filters_by_tag_and_kind_and_drops_notes_flagged_private_on_disk() {
    let fixture = graph();
    fixture.write_note("notes/old.md", "# Old\n#book\n");
    fixture.write_note("notes/fresh.md", "# Fresh\n#book #idea\n");
    fixture.write_note("notes/plain.md", "# Plain\n");
    fixture.write_note("daily/2026-06-11.md", "- day #book\n");
    fixture.write_note("templates/journal.md", "# Journal\n");
    fixture.build_index();
    fixture
        .index_conn()
        .execute(
            "UPDATE notes SET kind = 'template' WHERE path = 'templates/journal.md'",
            [],
        )
        .unwrap();
    for (path, updated) in [
        ("notes/old.md", 1_000_i64),
        ("notes/fresh.md", 3_000),
        ("notes/plain.md", 2_000),
        ("daily/2026-06-11.md", 4_000),
    ] {
        fixture.set_updated(path, updated);
    }
    for (path, tag) in [
        ("notes/old.md", "book"),
        ("notes/fresh.md", "book"),
        ("notes/fresh.md", "idea"),
        ("daily/2026-06-11.md", "book"),
    ] {
        fixture.insert_tag(path, tag);
    }

    let value = json(&reflect(&fixture, &["list", "--json"]));
    let paths: Vec<&str> = value["notes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|note| note["path"].as_str().unwrap())
        .collect();
    assert_eq!(
        paths,
        [
            "daily/2026-06-11.md",
            "notes/fresh.md",
            "notes/plain.md",
            "notes/old.md"
        ]
    );
    let fresh = &value["notes"][1];
    assert_eq!(fresh["kind"], "note");
    assert_eq!(fresh["tags"], serde_json::json!(["book", "idea"]));
    assert!(fresh["updatedAt"]
        .as_str()
        .unwrap()
        .starts_with("1970-01-01T00:00:03"));

    let by_tag = json(&reflect(
        &fixture,
        &["list", "--tag", "#Book", "--kind", "note", "--json"],
    ));
    let paths: Vec<&str> = by_tag["notes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|note| note["path"].as_str().unwrap())
        .collect();
    assert_eq!(paths, ["notes/fresh.md", "notes/old.md"]);

    // Flagged private after indexing: the on-disk frontmatter wins.
    fixture.write_note(
        "notes/fresh.md",
        "---\nprivate: true\n---\n# Fresh\n#book\n",
    );
    let after = reflect(&fixture, &["list", "--tag", "book", "--json"]);
    assert!(!stdout(&after).contains("fresh"), "{}", stdout(&after));
    assert!(stderr(&after).contains("stale"));

    let bad_kind = reflect(&fixture, &["list", "--kind", "page"]);
    assert_eq!(bad_kind.status.code(), Some(1));
}

#[test]
fn properties_prints_typed_frontmatter_without_reserved_keys() {
    let fixture = graph();
    fixture.write_note(
        "notes/dune.md",
        "---\nid: 01abc\naliases: [Arrakis Book]\npinned: true\nauthor: Herbert\n\
         rating: 4\nread: true\nread-on: 2026-01-02\ngenres:\n  - scifi\n  - classic\n\
         meta:\n  nested: 1\n---\n# Dune\n#book\n",
    );
    fixture.write_note(
        "notes/secret.md",
        "---\nprivate: true\nauthor: X\n---\n# S\n",
    );

    // File-only: works before any index exists.
    let value = json(&reflect(&fixture, &["properties", "Dune", "--json"]));
    assert_eq!(value["path"], "notes/dune.md");
    assert_eq!(value["title"], "Dune");
    assert_eq!(value["pinned"], true);
    assert_eq!(value["aliases"][0], "Arrakis Book");
    assert_eq!(value["tags"], serde_json::json!([]));
    assert_eq!(
        value["properties"],
        serde_json::json!({
            "author": "Herbert",
            "rating": 4,
            "read": true,
            "read-on": "2026-01-02",
            "genres": ["scifi", "classic"]
        })
    );

    fixture.build_index();
    fixture.insert_tag("notes/dune.md", "book");
    let value = json(&reflect(
        &fixture,
        &["properties", "notes/dune.md", "--json"],
    ));
    assert_eq!(value["tags"], serde_json::json!(["book"]));
    let human = stdout(&reflect(&fixture, &["properties", "Dune"]));
    assert!(human.contains("author\tHerbert"), "{human}");
    assert!(human.contains("genres\tscifi, classic"), "{human}");
    assert!(human.contains("tags\t#book"), "{human}");

    let private = reflect(&fixture, &["properties", "notes/secret.md"]);
    assert_eq!(private.status.code(), Some(3));
    assert!(!stdout(&private).contains("X"));
}

#[test]
fn links_resolves_targets_and_drops_private_ones() {
    let fixture = graph();
    fixture.write_note(
        "notes/dune.md",
        "# Dune\nBy [[Frank Herbert]] on [[Arrakis]]; see [[Frank Herbert]] and [[Secret]].\n",
    );
    fixture.write_note("notes/frank-herbert.md", "# Frank Herbert\n");
    fixture.write_note("notes/secret.md", "---\nprivate: true\n---\n# Secret\n");
    let missing = reflect(&fixture, &["links", "Dune"]);
    assert_eq!(missing.status.code(), Some(4));

    fixture.build_index();
    fixture.insert_link("notes/dune.md", "Frank Herbert", 10);
    fixture.insert_link("notes/dune.md", "Arrakis", 30);
    fixture.insert_link("notes/dune.md", "Frank Herbert", 50);
    fixture.insert_link("notes/dune.md", "Secret", 70);

    let value = json(&reflect(&fixture, &["links", "Dune", "--json"]));
    assert_eq!(value["path"], "notes/dune.md");
    let links = value["links"].as_array().unwrap();
    assert_eq!(links.len(), 2, "deduped and private dropped: {value}");
    assert_eq!(links[0]["target"], "Frank Herbert");
    assert_eq!(links[0]["path"], "notes/frank-herbert.md");
    assert_eq!(links[0]["title"], "Frank Herbert");
    assert_eq!(links[1]["target"], "Arrakis");
    assert!(links[1]["path"].is_null());
    assert!(!value.to_string().contains("secret"));

    let human = stdout(&reflect(&fixture, &["links", "Dune"]));
    assert!(human.contains("Arrakis\t(unresolved)"), "{human}");

    let private_source = reflect(&fixture, &["links", "notes/secret.md"]);
    assert_eq!(private_source.status.code(), Some(3));
}

// ---- Plan 30: structured writes -------------------------------------------

fn reflect_stdin(fixture: &Fixture, args: &[&str], input: &str) -> Output {
    use std::io::Write;
    let mut child = Command::new(env!("CARGO_BIN_EXE_reflect"))
        .args(args)
        .current_dir(fixture.root())
        .env_remove("REFLECT_GRAPH")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(input.as_bytes())
        .unwrap();
    child.wait_with_output().unwrap()
}

fn read(fixture: &Fixture, rel_path: &str) -> String {
    fs::read_to_string(fixture.root().join(rel_path)).unwrap()
}

const BOOK_SCHEMA: &str = r#"[
  {"name":"Author","key":"author","type":"relation","target":"person"},
  {"name":"Rating","key":"rating","type":"rating"},
  {"name":"Read","key":"read","type":"checkbox"},
  {"name":"Read on","key":"read-on","type":"date"},
  {"name":"Genres","key":"genres","type":"multiselect","options":["scifi","classic"]},
  {"name":"Added","key":"added","type":"created"},
  {"name":"Pages","key":"pages","type":"rollup","rollup":{"relation":"author","property":"x","aggregation":"count"}}
]"#;

#[test]
fn set_writes_typed_values_through_the_tag_schema_and_keeps_the_rest() {
    let fixture = graph();
    fixture.write_note(
        "notes/dune.md",
        "---\n# identity\nid: 01abc\nrating: 2\ndraft: yes\n---\n# Dune\n\nBody stays.\n\n#book\n",
    );
    fixture.write_note("notes/secret.md", "---\nprivate: true\n---\n# S\n#book\n");
    fixture.build_index();
    fixture.insert_tag("notes/dune.md", "book");
    fixture.insert_tag("notes/secret.md", "book");
    fixture.insert_tag_type("book", BOOK_SCHEMA);

    let value = json(&reflect(
        &fixture,
        &[
            "set",
            "Dune",
            "rating=4",
            "read=yes",
            "read-on=2026-01-02",
            "author=Frank Herbert",
            "genres=scifi, classic",
            "note=Plain: text",
            "--unset",
            "draft",
            "--json",
        ],
    ));
    assert_eq!(value["path"], "notes/dune.md");
    assert_eq!(
        value["set"],
        serde_json::json!({
            "rating": 4, "read": true, "read-on": "2026-01-02",
            "author": "[[Frank Herbert]]", "genres": ["scifi", "classic"], "note": "Plain: text"
        })
    );
    assert_eq!(value["unset"], serde_json::json!(["draft"]));
    assert_eq!(
        read(&fixture, "notes/dune.md"),
        "---\n# identity\nid: 01abc\nrating: 4\nread: true\nread-on: 2026-01-02\n\
         author: \"[[Frank Herbert]]\"\ngenres:\n  - scifi\n  - classic\nnote: \"Plain: text\"\n---\n\
         # Dune\n\nBody stays.\n\n#book\n"
    );
    // The written values read back typed through the CLI's own reader.
    let properties = json(&reflect(&fixture, &["properties", "Dune", "--json"]));
    assert_eq!(properties["properties"]["rating"], 4);
    assert_eq!(properties["properties"]["read"], true);
    assert!(properties["properties"].get("draft").is_none());

    let bad_rating = reflect(&fixture, &["set", "Dune", "rating=9"]);
    assert_eq!(bad_rating.status.code(), Some(2));
    let reserved = reflect(&fixture, &["set", "Dune", "private=true"]);
    assert_eq!(reserved.status.code(), Some(2));
    let view_only = reflect(&fixture, &["set", "Dune", "pages=3"]);
    assert_eq!(view_only.status.code(), Some(2));
    assert!(stderr(&view_only).contains("computed"));
    let private = reflect(&fixture, &["set", "notes/secret.md", "rating=1"]);
    assert_eq!(private.status.code(), Some(3));
    assert!(read(&fixture, "notes/secret.md").contains("private: true\n---\n# S"));

    // No index: still writes, as text, with a warning.
    fs::remove_file(fixture.root().join(".reflect/index.sqlite")).unwrap();
    let untyped = reflect(&fixture, &["set", "notes/dune.md", "year=1965", "--json"]);
    assert_eq!(untyped.status.code(), Some(0));
    assert!(stderr(&untyped).contains("no index"));
    assert_eq!(json(&untyped)["set"]["year"], "1965");
    assert!(read(&fixture, "notes/dune.md").contains("year: \"1965\"\n"));
}

#[test]
fn tag_appends_a_trailing_line_and_stamps_created_and_untag_removes_only_that() {
    let fixture = graph();
    fixture.write_note("notes/dune.md", "---\nid: 01abc\n---\n# Dune\n\nBody.\n");
    fixture.write_note("notes/emma.md", "# Emma\nA #book about manners.\n");
    fixture.build_index();
    fixture.insert_tag_type("book", BOOK_SCHEMA);

    let value = json(&reflect(&fixture, &["tag", "Dune", "#Book", "--json"]));
    assert_eq!(value["added"], true);
    let today = reflect_cli::paths::today_date();
    assert_eq!(value["stamped"]["added"], today);
    assert_eq!(
        read(&fixture, "notes/dune.md"),
        format!("---\nid: 01abc\nadded: {today}\n---\n# Dune\n\nBody.\n\n#Book\n")
    );
    let again = json(&reflect(&fixture, &["tag", "Dune", "book", "--json"]));
    assert_eq!(again["added"], false, "idempotent: {again}");
    assert_eq!(again["stamped"], serde_json::json!({}));

    let removed = json(&reflect(&fixture, &["untag", "Dune", "book", "--json"]));
    assert_eq!(removed["removed"], true);
    assert_eq!(
        read(&fixture, "notes/dune.md"),
        format!("---\nid: 01abc\nadded: {today}\n---\n# Dune\n\nBody.\n")
    );
    let absent = json(&reflect(&fixture, &["untag", "Dune", "book", "--json"]));
    assert_eq!(absent["removed"], false);

    let inline = reflect(&fixture, &["untag", "Emma", "book"]);
    assert_eq!(inline.status.code(), Some(1));
    assert!(stderr(&inline).contains("inline"));
    assert_eq!(
        read(&fixture, "notes/emma.md"),
        "# Emma\nA #book about manners.\n"
    );

    let bad = reflect(&fixture, &["tag", "Dune", "2nd"]);
    assert_eq!(bad.status.code(), Some(2));
}

#[test]
fn done_toggles_the_marker_by_text_and_refuses_ambiguity_or_drift() {
    let fixture = graph();
    fixture.write_note(
        "notes/project.md",
        "# Project\n+ [ ] pay bill\n+ [ ] call Ann\n  - [ ] call Ann again\n+ [x] shipped\n",
    );
    fixture.write_note("daily/2026-06-11.md", "- [ ] pay bill\n");
    fixture.build_index();
    fixture.insert_task("notes/project.md", 12, "pay bill", false, None, None);
    fixture.insert_task("notes/project.md", 27, "call Ann", false, None, None);
    fixture.insert_task("notes/project.md", 44, "call Ann again", false, None, None);
    fixture.insert_task("daily/2026-06-11.md", 2, "pay bill", false, None, None);
    fixture.index_conn()
        .execute(
            "INSERT INTO tasks(note_path, marker_offset, text, raw, checked) VALUES('notes/project.md', 65, 'shipped', '[x] shipped', 1)",
            [],
        )
        .unwrap();

    let ambiguous = reflect(&fixture, &["done", "pay bill"]);
    assert_eq!(ambiguous.status.code(), Some(3));
    assert!(stderr(&ambiguous).contains("daily/2026-06-11.md\tpay bill"));

    let value = json(&reflect(
        &fixture,
        &["done", "pay bill", "--in", "Project", "--json"],
    ));
    assert_eq!(
        value,
        serde_json::json!({"path": "notes/project.md", "text": "pay bill", "checked": true})
    );
    // Exact match beats the substring match; only the marker changed.
    let value = json(&reflect(&fixture, &["done", "Call Ann", "--json"]));
    assert_eq!(value["text"], "call Ann");
    assert_eq!(
        read(&fixture, "notes/project.md"),
        "# Project\n+ [x] pay bill\n+ [x] call Ann\n  - [ ] call Ann again\n+ [x] shipped\n"
    );
    let undone = json(&reflect(&fixture, &["done", "shipped", "--undo", "--json"]));
    assert_eq!(undone["checked"], false);
    assert!(read(&fixture, "notes/project.md").contains("+ [ ] shipped\n"));

    // The line moved: still found when it is the unique match…
    fixture.write_note(
        "notes/project.md",
        "# Project\nIntro line.\n+ [x] pay bill\n+ [x] call Ann\n  - [ ] call Ann again\n+ [ ] shipped\n",
    );
    let moved = json(&reflect(&fixture, &["done", "again", "--json"]));
    assert_eq!(moved["text"], "call Ann again");
    assert!(read(&fixture, "notes/project.md").contains("  - [x] call Ann again\n"));
    // …and refused when it is gone.
    fixture.write_note("notes/project.md", "# Project\n+ [ ] something else\n");
    // (The index still lists `shipped` as done — the CLI never re-indexes.)
    let drifted = reflect(&fixture, &["done", "shipped", "--undo"]);
    assert_eq!(drifted.status.code(), Some(1));
    assert!(stderr(&drifted).contains("no longer matches"));

    let nothing = reflect(&fixture, &["done", "nope"]);
    assert_eq!(nothing.status.code(), Some(3));
}

#[test]
fn append_adds_a_block_and_creates_dailies_and_capture_reads_stdin() {
    let fixture = graph();
    fixture.write_note("notes/dune.md", "# Dune\n\nBody.\n");
    fixture.write_note("notes/secret.md", "---\nprivate: true\n---\n# S\n");

    let value = json(&reflect_stdin(
        &fixture,
        &["append", "Dune", "--stdin", "--json"],
        "## Notes\n\n- one\n- two\n",
    ));
    assert_eq!(value["path"], "notes/dune.md");
    assert_eq!(value["created"], false);
    assert_eq!(
        read(&fixture, "notes/dune.md"),
        "# Dune\n\nBody.\n\n## Notes\n\n- one\n- two\n"
    );

    let daily = json(&reflect(
        &fixture,
        &["append", "2026-06-11", "First entry", "--json"],
    ));
    assert_eq!(daily["created"], true);
    assert_eq!(daily["date"], "2026-06-11");
    assert_eq!(read(&fixture, "daily/2026-06-11.md"), "First entry\n");

    let private = reflect(&fixture, &["append", "notes/secret.md", "x"]);
    assert_eq!(private.status.code(), Some(3));
    let missing = reflect(&fixture, &["append", "Nope", "x"]);
    assert_eq!(missing.status.code(), Some(3));
    let empty = reflect_stdin(&fixture, &["append", "Dune", "--stdin"], "  \n");
    assert_eq!(empty.status.code(), Some(2));

    let captured = json(&reflect_stdin(
        &fixture,
        &["capture", "--stdin", "--to", "Dune", "--json"],
        "from\nstdin\n",
    ));
    assert_eq!(captured["item"], "- from stdin");
    assert!(read(&fixture, "notes/dune.md").ends_with("- two\n- from stdin\n"));
}

#[test]
fn new_with_tags_and_sets_births_a_typed_row() {
    let fixture = graph();
    fixture.write_note("templates/book.md", "---\nid: t\n---\nRating: {{title}}\n");
    fixture.build_index();
    fixture.insert_tag_type(
        "book",
        r#"{"properties":[{"name":"Rating","key":"rating","type":"rating"},{"name":"Added","key":"added","type":"created"}],"template":"templates/book.md"}"#,
    );

    let value = json(&reflect(
        &fixture,
        &[
            "new",
            "Left Hand",
            "--tag",
            "#book",
            "--tag",
            "idea",
            "--set",
            "rating=5",
            "--json",
        ],
    ));
    assert_eq!(value["path"], "notes/left-hand.md");
    assert_eq!(value["tags"], serde_json::json!(["book", "idea"]));
    let today = reflect_cli::paths::today_date();
    assert_eq!(
        value["properties"],
        serde_json::json!({"rating": 5, "added": today})
    );
    assert_eq!(
        read(&fixture, "notes/left-hand.md"),
        format!("---\nrating: 5\nadded: {today}\n---\n# Left Hand\n\nRating: Left Hand\n\n#book\n\n#idea\n")
    );

    let from_stdin = json(&reflect_stdin(
        &fixture,
        &["new", "Plain", "--stdin", "--json"],
        "Some body.\n",
    ));
    assert_eq!(from_stdin["properties"], serde_json::json!({}));
    assert_eq!(read(&fixture, "notes/plain.md"), "# Plain\n\nSome body.\n");

    let bad = reflect(
        &fixture,
        &["new", "Bad", "--tag", "book", "--set", "rating=nine"],
    );
    assert_eq!(bad.status.code(), Some(2));
    assert!(!fixture.root().join("notes/bad.md").exists());
}
