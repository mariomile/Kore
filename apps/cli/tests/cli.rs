//! End-to-end tests for the CLI's read and discovery surface, run against the
//! real `kore` binary and the fixture graphs in `common`.

mod common;

use std::fs;
use std::process::Command;

use rusqlite::params;
use tempfile::TempDir;

use common::*;
use reflect_cli::paths::{daily_path, today_date};

/// A graph with the standard layout but no index file.

// ---- today ------------------------------------------------------------------

#[test]
fn today_prints_the_daily_note_with_no_index() {
    let fixture = graph();
    let content = "remember the milk\n";
    fixture.write_note(&daily_path(&today_date()), content);

    let output = kore(&fixture, &["today"]);
    assert!(output.status.success(), "stderr: {}", stderr(&output));
    assert_eq!(stdout(&output), content);
}

#[test]
fn today_path_prints_the_would_be_path_before_the_file_exists() {
    let fixture = graph();
    let output = kore(&fixture, &["today", "--path"]);
    assert!(output.status.success());
    let expected = daily_path(&today_date());
    assert!(stdout(&output).trim_end().ends_with(&expected));

    let missing = kore(&fixture, &["today"]);
    assert_eq!(missing.status.code(), Some(3));
    assert!(stderr(&missing).contains("no daily note"));
}

#[test]
fn today_json_shape() {
    let fixture = graph();
    fixture.write_note(&daily_path(&today_date()), "# Plans\nship it\n");

    let value = json(&kore(&fixture, &["today", "--json"]));
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

    let output = kore(&fixture, &["today"]);
    assert_eq!(output.status.code(), Some(3));
    assert_eq!(stdout(&output), "");
    assert!(stderr(&output).contains("private"));

    let path_output = kore(&fixture, &["today", "--path"]);
    assert_eq!(path_output.status.code(), Some(3));
}

// ---- graph resolution ---------------------------------------------------------

#[test]
fn graph_resolves_by_walking_up_from_a_subdirectory() {
    let fixture = graph();
    let content = "found from a subdir\n";
    fixture.write_note(&daily_path(&today_date()), content);

    let output = Command::new(env!("CARGO_BIN_EXE_kore"))
        .args(["today"])
        .current_dir(fixture.root().join("notes"))
        .env_remove("KORE_GRAPH")
        .output()
        .unwrap();
    assert!(output.status.success());
    assert_eq!(stdout(&output), content);
}

#[test]
fn explicit_graph_flag_rejects_a_non_graph() {
    let fixture = graph();
    let not_a_graph = TempDir::new().unwrap();
    let output = kore(
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
    let output = Command::new(env!("CARGO_BIN_EXE_kore"))
        .args(["today"])
        .current_dir(elsewhere.path())
        .env("KORE_GRAPH", fixture.root())
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

    let output = kore(&fixture, &["search", "zebra"]);
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

    let text = stdout(&kore(&fixture, &["search", "quokka"]));
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

    let text = stdout(&kore(&fixture, &["search", "東京"]));
    let title_pos = text.find("notes/title-hit.md").unwrap();
    let body_pos = text.find("notes/body-hit.md").unwrap();
    assert!(
        title_pos < body_pos,
        "expected the title substring match before the body match:\n{text}"
    );

    let multi_term = stdout(&kore(&fixture, &["search", "東京 旅行"]));
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

    let text = stdout(&kore(&fixture, &["search", "car"]));
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

    let text = stdout(&kore(&fixture, &["search", "Tim Mac"]));
    assert!(
        text.contains("notes/Tim MacCaw.md"),
        "expected the partial title match:\n{text}"
    );

    let value = json(&kore(&fixture, &["search", "Tim Mac", "--json"]));
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

    let value = json(&kore(&fixture, &["search", "cafe", "--json"]));
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

    let text = stdout(&kore(&fixture, &["search", "Tim Mac"]));
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

    let text = stdout(&kore(&fixture, &["search", "authent migr"]));
    assert!(
        text.contains("notes/security-rollout.md"),
        "expected partial body terms to match:\n{text}"
    );

    let mixed = stdout(&kore(&fixture, &["search", "secur migr"]));
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

    let text = stdout(&kore(&fixture, &["search", "meeting - notes"]));
    assert!(
        text.contains("notes/meeting-notes.md"),
        "expected the punctuation term to be ignored:\n{text}"
    );

    let punctuation = stdout(&kore(&fixture, &["search", ". -"]));
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

    let text = stdout(&kore(&fixture, &["search", "zebra"]));
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

    let text = stdout(&kore(&fixture, &["search", "apricot"]));
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
    let output = kore(&fixture, &["search", "anything"]);
    assert_eq!(output.status.code(), Some(4));
    assert!(stderr(&output).contains("no index at"));
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

    let output = kore(&fixture, &["search", "alpha"]);
    assert!(output.status.success());
    assert!(stderr(&output).contains("stale"));
    assert!(stdout(&output).contains("notes/a.md"));

    let value = json(&kore(&fixture, &["search", "alpha", "--json"]));
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

    let output = kore(&fixture, &["search", "searchable"]);
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

    let show = kore(&fixture, &["show", "Plan"]);
    assert!(!show.status.success());
    assert!(!stdout(&show).contains("outside secret"));

    let search = kore(&fixture, &["search", "indexed"]);
    assert!(search.status.success(), "stderr: {}", stderr(&search));
    assert_eq!(stdout(&search), "");
}

#[test]
fn search_json_shape() {
    let fixture = graph();
    fixture.write_note("notes/a.md", "# Alpha\nsearchable text\n");
    fixture.build_index();

    let value = json(&kore(&fixture, &["search", "searchable", "--json"]));
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

    let output = kore(&fixture, &["search", "searchable"]);
    assert!(output.status.success());
    assert_eq!(stdout(&output), "", "a just-flagged note must not surface");
}

// ---- search operators (the palette grammar, `filter-query.ts`) ---------------

/// The paths `kore search --json` returned, in order.
fn search_paths(fixture: &Fixture, query: &str) -> Vec<String> {
    let value = json(&kore(fixture, &["search", query, "--json"]));
    value["results"]
        .as_array()
        .unwrap()
        .iter()
        .map(|hit| hit["path"].as_str().unwrap().to_string())
        .collect()
}

/// A small vault shaped like an Obsidian one: CRM people, a journal, a project.
fn operator_fixture() -> Fixture {
    let fixture = graph();
    fixture.write_note("CRM/People/Ada.md", "# Ada\nmet Ada about the roadmap\n");
    fixture.write_note("CRM/People/Bob copy.md", "# Bob\nroadmap draft notes\n");
    fixture.write_note(
        "CRM/Companies/Acme.md",
        "# Acme\nroadmap for next quarter\n",
    );
    fixture.write_note(
        "Journal/2026-10-01.md",
        "# Journal\nroadmap for next quarter thoughts\n",
    );
    fixture.write_note(
        "notes/secret.md",
        "---\nprivate: true\n---\n# Secret\nroadmap\n",
    );
    fixture.build_index();
    fixture.insert_tag("CRM/People/Ada.md", "type/person");
    fixture.insert_tag("CRM/People/Bob copy.md", "type/person");
    fixture.insert_tag("CRM/People/Bob copy.md", "archive");
    fixture.insert_tag("CRM/Companies/Acme.md", "type/company");
    fixture.insert_tag("notes/secret.md", "type/person");
    fixture
}

/// `tag:#type/person path:CRM/` — the live test from the app — filters the
/// same way from the CLI, nested tags included, with no free text at all.
#[test]
fn search_filters_by_tag_and_path_with_no_text() {
    let fixture = operator_fixture();
    let mut people = search_paths(&fixture, "tag:#type/person path:CRM/");
    people.sort();
    assert_eq!(people, ["CRM/People/Ada.md", "CRM/People/Bob copy.md"]);

    // `#type` also finds `#type/person` and `#type/company`.
    let mut typed = search_paths(&fixture, "#type");
    typed.sort();
    assert_eq!(
        typed,
        [
            "CRM/Companies/Acme.md",
            "CRM/People/Ada.md",
            "CRM/People/Bob copy.md"
        ]
    );
    // Path containment is case-insensitive.
    assert_eq!(
        search_paths(&fixture, "path:crm/companies"),
        ["CRM/Companies/Acme.md"]
    );
}

#[test]
fn search_combines_text_with_exclusions() {
    let fixture = operator_fixture();
    let mut hits = search_paths(&fixture, "roadmap -#archive -path:Journal");
    hits.sort();
    assert_eq!(hits, ["CRM/Companies/Acme.md", "CRM/People/Ada.md"]);

    // `-draft` drops the note whose body says "draft"; `-file:copy` the file.
    assert!(
        !search_paths(&fixture, "roadmap -draft").contains(&"CRM/People/Bob copy.md".to_string())
    );
    let mut files = search_paths(&fixture, "roadmap -file:copy file:a");
    files.sort();
    assert_eq!(files, ["CRM/Companies/Acme.md", "CRM/People/Ada.md"]);
}

#[test]
fn search_matches_exact_phrases_and_excludes_them() {
    let fixture = operator_fixture();
    let mut phrase = search_paths(&fixture, "\"next quarter\"");
    phrase.sort();
    assert_eq!(phrase, ["CRM/Companies/Acme.md", "Journal/2026-10-01.md"]);
    // The words out of order are not the phrase.
    assert!(search_paths(&fixture, "\"quarter next\"").is_empty());
    assert_eq!(
        search_paths(&fixture, "roadmap -\"next quarter\" -#archive"),
        ["CRM/People/Ada.md"]
    );
}

#[test]
fn search_filters_by_property_and_link() {
    let fixture = operator_fixture();
    let conn = fixture.index_conn();
    conn.execute(
        "INSERT INTO note_properties(note_path, key, value, value_type, value_number)
         VALUES('CRM/People/Ada.md', 'status', 'in progress', 'string', NULL)",
        [],
    )
    .unwrap();
    drop(conn);
    fixture.insert_wiki_link("Journal/2026-10-01.md", "Ada", 0);

    assert_eq!(
        search_paths(&fixture, "[status:In Progress]"),
        ["CRM/People/Ada.md"]
    );
    assert_eq!(search_paths(&fixture, "prop:status"), ["CRM/People/Ada.md"]);
    assert_eq!(
        search_paths(&fixture, "links:Ada"),
        ["Journal/2026-10-01.md"]
    );
    assert_eq!(
        search_paths(&fixture, "linked-from:Journal/2026-10-01.md"),
        ["CRM/People/Ada.md"]
    );
    // A date resolves like a `[[2026-10-01]]` link: to the note claiming it
    // (here a dated journal note outside `daily/`), not a constructed path.
    fixture.insert_wiki_link("CRM/People/Ada.md", "2026-10-01", 1);
    assert_eq!(
        search_paths(&fixture, "links:2026-10-01"),
        ["CRM/People/Ada.md"]
    );
    // A target that names no note matches nothing rather than being ignored.
    assert!(search_paths(&fixture, "roadmap links:Nobody").is_empty());
}

#[test]
fn search_operators_never_surface_or_reveal_private_notes() {
    let fixture = operator_fixture();
    assert!(!search_paths(&fixture, "#type/person").contains(&"notes/secret.md".to_string()));
    let refused = kore(&fixture, &["search", "links:notes/secret.md"]);
    assert_eq!(
        refused.status.code(),
        Some(3),
        "stderr: {}",
        stderr(&refused)
    );
}

/// Half-formed operators stay plain text, as in the palette.
#[test]
fn search_keeps_half_formed_operators_as_text() {
    let fixture = operator_fixture();
    assert!(search_paths(&fixture, "path:").is_empty());
    assert_eq!(
        search_paths(&fixture, "roadmap -").len(),
        search_paths(&fixture, "roadmap").len()
    );
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
        let output = kore(&fixture, &["show", arg]);
        assert!(output.status.success(), "show {arg}: {}", stderr(&output));
        assert!(stdout(&output).contains("the plan"), "show {arg}");
    }
    let by_date = kore(&fixture, &["show", "2026-01-02"]);
    assert_eq!(stdout(&by_date), "daily body\n");

    let missing_daily = kore(&fixture, &["show", "2026-01-03"]);
    assert_eq!(missing_daily.status.code(), Some(3));

    let unknown = kore(&fixture, &["show", "No Such Note"]);
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
        let output = kore(&fixture, &["show", arg]);
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

    let output = kore(&fixture, &["show", "Alpha"]);
    assert_eq!(output.status.code(), Some(3));
    assert_eq!(stdout(&output), "");
    assert!(stderr(&output).contains("private"));

    let path_output = kore(&fixture, &["path", "Alpha"]);
    assert_eq!(path_output.status.code(), Some(3));
}

#[test]
fn show_json_includes_the_daily_date() {
    let fixture = graph();
    fixture.write_note("daily/2026-01-02.md", "daily body\n");

    let value = json(&kore(&fixture, &["show", "2026-01-02", "--json"]));
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

    let by_title = kore(&fixture, &["path", "Project X"]);
    assert!(by_title.status.success());
    assert!(stdout(&by_title).trim_end().ends_with("notes/project-x.md"));

    let value = json(&kore(&fixture, &["path", "2099-01-01", "--json"]));
    assert_eq!(value["date"], "2099-01-01");
    assert_eq!(value["path"], "daily/2099-01-01.md");
    assert_eq!(value["exists"], false);

    let existing = json(&kore(&fixture, &["path", "notes/project-x.md", "--json"]));
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

    let output = kore(&fixture, &["open", "Project X", "--print"]);
    assert!(output.status.success(), "stderr: {}", stderr(&output));
    assert_eq!(stdout(&output), "kore://note/01hzy3v9k2m4n6p8q0r2s4t6vw\n");
}

#[test]
fn open_print_falls_back_to_the_encoded_path_without_an_id() {
    let fixture = graph();
    fixture.write_note("notes/no id here.md", "# No Id Here\n");
    fixture.build_index();

    let output = kore(&fixture, &["open", "No Id Here", "--print"]);
    assert!(output.status.success(), "stderr: {}", stderr(&output));
    assert_eq!(stdout(&output), "kore://note/notes%2Fno%20id%20here.md\n");
}

#[test]
fn open_print_gives_dailies_the_date_form_even_before_the_file_exists() {
    let fixture = graph();

    let would_be = kore(&fixture, &["open", "2099-01-01", "--print"]);
    assert!(would_be.status.success(), "stderr: {}", stderr(&would_be));
    assert_eq!(stdout(&would_be), "kore://daily/2099-01-01\n");

    // An existing daily resolved by explicit path gets the date form too.
    fixture.write_note("daily/2026-01-02.md", "daily body\n");
    let by_path = kore(&fixture, &["open", "daily/2026-01-02.md", "--print"]);
    assert_eq!(stdout(&by_path), "kore://daily/2026-01-02\n");
}

#[test]
fn open_resolves_by_title_and_alias_without_an_index() {
    let fixture = graph();
    fixture.write_note(
        "notes/project-x.md",
        "---\nid: 01hzy3v9k2m4n6p8q0r2s4t6vw\naliases: [PX]\n---\n# Project X\n",
    );

    for arg in ["project x", "PX"] {
        let output = kore(&fixture, &["open", arg, "--print"]);
        assert!(output.status.success(), "open {arg}: {}", stderr(&output));
        assert_eq!(
            stdout(&output),
            "kore://note/01hzy3v9k2m4n6p8q0r2s4t6vw\n",
            "open {arg}"
        );
    }
}

#[test]
fn open_refuses_private_notes_and_unknown_targets() {
    let fixture = graph();
    fixture.write_note("notes/a.md", "---\nprivate: true\n---\n# Alpha\n");
    fixture.build_index();

    let private = kore(&fixture, &["open", "notes/a.md", "--print"]);
    assert_eq!(private.status.code(), Some(3));
    assert_eq!(
        stdout(&private),
        "",
        "a private note's address must not leak"
    );
    assert!(stderr(&private).contains("private"));

    let unknown = kore(&fixture, &["open", "No Such Note", "--print"]);
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

    let note = json(&kore(&fixture, &["open", "Project X", "--print", "--json"]));
    assert_eq!(note["path"], "notes/project-x.md");
    assert_eq!(note["url"], "kore://note/01hzy3v9k2m4n6p8q0r2s4t6vw");
    assert_eq!(note["launched"], false);
    assert!(note.get("date").is_none());

    let daily = json(&kore(
        &fixture,
        &["open", "2026-01-02", "--json", "--print"],
    ));
    assert_eq!(daily["date"], "2026-01-02");
    assert_eq!(daily["path"], "daily/2026-01-02.md");
    assert_eq!(daily["url"], "kore://daily/2026-01-02");
}

#[test]
fn show_resolves_a_note_by_its_filename_stem() {
    // The H1 differs from the filename: Obsidian's convention. Both spellings
    // must resolve, with or without an index.
    let fixture = graph();
    fixture.write_note("Projects/Plan.md", "# Weekly Planning\nstem body\n");

    let by_stem = kore(&fixture, &["show", "Plan"]);
    assert!(by_stem.status.success(), "{}", stderr(&by_stem));
    assert!(stdout(&by_stem).contains("stem body"));

    fixture.build_index();
    let indexed = kore(&fixture, &["show", "Plan"]);
    assert!(indexed.status.success(), "{}", stderr(&indexed));
    assert!(stdout(&indexed).contains("stem body"));
}

#[test]
fn show_prefers_a_title_over_a_filename_stem() {
    let fixture = graph();
    fixture.write_note("Archive/old.md", "# Plan\ntitled body\n");
    fixture.write_note("Projects/Plan.md", "# Weekly Planning\nstem body\n");

    let scanned = kore(&fixture, &["show", "Plan"]);
    assert!(scanned.status.success(), "{}", stderr(&scanned));
    assert!(stdout(&scanned).contains("titled body"));

    fixture.build_index();
    let indexed = kore(&fixture, &["show", "Plan"]);
    assert!(indexed.status.success(), "{}", stderr(&indexed));
    assert!(stdout(&indexed).contains("titled body"));
}

#[test]
fn show_resolves_a_nested_vault_path_argument() {
    let fixture = graph();
    fixture.write_note("Projects/deep/Plan.md", "# Anything\nnested body\n");

    let output = kore(&fixture, &["show", "Projects/deep/Plan.md"]);
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

    let scanned = kore(&fixture, &["path", "Plan"]);
    assert!(scanned.status.success(), "{}", stderr(&scanned));
    let scanned_path = stdout(&scanned);

    fixture.build_index();
    let indexed = kore(&fixture, &["path", "Plan"]);
    assert!(indexed.status.success(), "{}", stderr(&indexed));
    assert_eq!(stdout(&indexed), scanned_path);
    assert!(scanned_path.contains("a/Plan.md"));
}

// ---- tasks ------------------------------------------------------------------

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

    let value = json(&kore(&fixture, &["tasks", "--json"]));
    let tasks = value["tasks"].as_array().unwrap();
    assert_eq!(tasks.len(), 1, "only the public open task: {value}");
    assert_eq!(tasks[0]["path"], "notes/project.md");
    assert_eq!(tasks[0]["title"], "Project X");
    assert_eq!(tasks[0]["text"], "pay bill");
    assert_eq!(tasks[0]["checked"], false);
    assert_eq!(tasks[0]["dueDate"], "2026-08-22");

    let all = json(&kore(&fixture, &["tasks", "--all", "--json"]));
    assert_eq!(all["tasks"].as_array().unwrap().len(), 2);

    let human = kore(&fixture, &["tasks"]);
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

    let value = json(&kore(&fixture, &["tasks", "--json"]));
    let tasks = value["tasks"].as_array().unwrap();
    assert_eq!(tasks.len(), 1, "only the timed task: {value}");
    assert_eq!(tasks[0]["dueDate"], "2026-08-22");
    assert_eq!(tasks[0]["dueTime"], "14:30");

    let human = kore(&fixture, &["tasks"]);
    assert!(human.status.success());
    assert!(stdout(&human).contains("  [ ] dentist  (due 2026-08-22 14:30)"));
}

#[test]
fn tasks_without_an_index_exits_4() {
    let fixture = graph();
    let output = kore(&fixture, &["tasks"]);
    assert_eq!(output.status.code(), Some(4));
    assert!(stderr(&output).contains("open this graph in Kore"));
}

// ---- capture ----------------------------------------------------------------

#[test]
fn capture_joins_todays_trailing_list() {
    let fixture = graph();
    let rel_path = daily_path(&today_date());
    let absolute = fixture.write_note(&rel_path, "# Plans\n\n- one\n");

    let output = kore(&fixture, &["capture", "two"]);
    assert!(output.status.success(), "stderr: {}", stderr(&output));
    // The CLI prints the canonical path (macOS: `/private/var/…` for a
    // `/var/…` temp dir), so compare canonical forms.
    assert_eq!(
        stdout(&output).trim_end(),
        absolute.canonicalize().unwrap().display().to_string()
    );
    assert_eq!(
        fs::read_to_string(&absolute).unwrap(),
        "# Plans\n\n- one\n- two\n"
    );
}

#[test]
fn capture_task_creates_the_daily_and_reports_json() {
    let fixture = graph();
    let value = json(&kore(
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

    let output = kore(&fixture, &["capture", "never lands"]);
    assert_eq!(output.status.code(), Some(3));
    assert!(stderr(&output).contains("private"));
    assert_eq!(fs::read_to_string(absolute).unwrap(), content);
}

#[test]
fn capture_rejects_empty_text_and_collapses_line_breaks() {
    let fixture = graph();
    let empty = kore(&fixture, &["capture", "  \n  "]);
    assert_eq!(empty.status.code(), Some(1));

    let output = kore(&fixture, &["capture", "line one\nline two"]);
    assert!(output.status.success(), "stderr: {}", stderr(&output));
    let absolute = fixture.root().join(daily_path(&today_date()));
    assert_eq!(
        fs::read_to_string(absolute).unwrap(),
        "- line one line two\n"
    );
}

// ---- backlinks --------------------------------------------------------------

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

    let value = json(&kore(&fixture, &["backlinks", "Target", "--json"]));
    assert_eq!(value["path"], "notes/target.md");
    assert_eq!(value["title"], "Target");
    let backlinks = value["backlinks"].as_array().unwrap();
    assert_eq!(backlinks.len(), 2, "private source excluded: {value}");
    assert_eq!(backlinks[0]["path"], "notes/a.md");
    assert_eq!(backlinks[0]["count"], 1);
    assert_eq!(backlinks[1]["path"], "notes/b.md");
    assert_eq!(backlinks[1]["count"], 2);

    let human = kore(&fixture, &["backlinks", "Target"]);
    assert!(human.status.success());
    assert!(stdout(&human).contains("notes/b.md\tB\t(2 links)"));
    assert!(!stdout(&human).contains("secret"));
}

#[test]
fn backlinks_refuses_a_private_target_and_needs_the_index() {
    let fixture = graph();
    let no_index = kore(&fixture, &["backlinks", "Anything"]);
    assert_eq!(no_index.status.code(), Some(4));

    fixture.write_note(
        "notes/secret.md",
        "---\nprivate: true\n---\n# Secret\nbody\n",
    );
    fixture.build_index();
    let output = kore(&fixture, &["backlinks", "notes/secret.md"]);
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

    let value = json(&kore(&fixture, &["recent", "--json"]));
    let notes = value["notes"].as_array().unwrap();
    assert_eq!(notes.len(), 2, "private + template excluded: {value}");
    assert_eq!(notes[0]["path"], "notes/fresh.md");
    assert_eq!(notes[1]["path"], "notes/old.md");
    assert!(notes[0]["updatedAt"]
        .as_str()
        .unwrap()
        .starts_with("1970-01-01T"));

    let limited = json(&kore(&fixture, &["recent", "--limit", "1", "--json"]));
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

    let value = json(&kore(&fixture, &["collection", "Book", "--json"]));
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
    let sorted = json(&kore(
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
    let missing = kore(&fixture, &["collection", "plain"]);
    assert_eq!(missing.status.code(), Some(4), "no index yet");

    fixture.build_index();
    let untyped = kore(&fixture, &["collection", "plain"]);
    assert_eq!(untyped.status.code(), Some(3));
    assert!(stderr(&untyped).contains("no type"));
}

// ---- new --------------------------------------------------------------------

#[test]
fn new_creates_titled_notes_with_collision_suffixes() {
    let fixture = graph();
    let value = json(&kore(&fixture, &["new", "Meeting Notes!", "--json"]));
    assert_eq!(value["path"], "notes/meeting-notes.md");
    assert_eq!(value["title"], "Meeting Notes!");
    assert_eq!(
        fs::read_to_string(fixture.root().join("notes/meeting-notes.md")).unwrap(),
        "# Meeting Notes!\n"
    );

    let second = json(&kore(&fixture, &["new", "Meeting Notes!", "--json"]));
    assert_eq!(second["path"], "notes/meeting-notes-2.md");

    let human = kore(&fixture, &["new", "Other"]);
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
    let value = json(&kore(
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
    kore(&fixture, &["new", "Plain One", "--template", "plain"]);
    assert_eq!(
        fs::read_to_string(fixture.root().join("notes/plain-one.md")).unwrap(),
        "# Plain One\n\nMood:\n"
    );

    let missing = kore(&fixture, &["new", "X", "--template", "nope"]);
    assert_eq!(missing.status.code(), Some(3));

    fixture.write_note(
        "templates/hidden.md",
        "---\nprivate: true\n---\nsecret seed\n",
    );
    let private = kore(&fixture, &["new", "Y", "--template", "hidden"]);
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

    let value = json(&kore(
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
    let dated = json(&kore(
        &fixture,
        &["capture", "plan ahead", "--to", "2099-01-02", "--json"],
    ));
    assert_eq!(dated["date"], "2099-01-02");
    assert_eq!(dated["created"], true);
    assert_eq!(
        fs::read_to_string(fixture.root().join("daily/2099-01-02.md")).unwrap(),
        "- plan ahead\n"
    );

    let private = kore(&fixture, &["capture", "x", "--to", "Secret"]);
    assert_eq!(private.status.code(), Some(3));

    let unknown = kore(&fixture, &["capture", "x", "--to", "No Such Note"]);
    assert_eq!(unknown.status.code(), Some(3));
}

// ---- Plan 30: discovery ------------------------------------------------------

#[test]
fn info_reports_the_missing_index_then_counts_once_built() {
    let fixture = graph();
    fixture.write_note("notes/a.md", "# A\n#idea\n");
    fixture.write_note("daily/2026-06-11.md", "- day\n");
    fixture.write_note("notes/secret.md", "---\nprivate: true\n---\n# S\n#idea\n");

    let before = kore(&fixture, &["info", "--json"]);
    assert_eq!(before.status.code(), Some(0), "info never needs the index");
    let value = json(&before);
    assert_eq!(value["index"]["present"], false);
    assert!(value["counts"].is_null());
    assert_eq!(value["cliVersion"], env!("CARGO_PKG_VERSION"));

    fixture.build_index();
    fixture.insert_tag("notes/a.md", "idea");
    fixture.insert_tag("notes/secret.md", "idea");
    let value = json(&kore(&fixture, &["info", "--json"]));
    assert_eq!(value["index"]["present"], true);
    assert_eq!(value["index"]["usable"], true);
    assert_eq!(value["index"]["stale"], false);
    assert_eq!(value["counts"]["notes"], 1, "private note not counted");
    assert_eq!(value["counts"]["dailies"], 1);
    assert_eq!(value["counts"]["tags"], 1);

    let human = stdout(&kore(&fixture, &["info"]));
    assert!(human.contains("index\tfresh"), "{human}");
}

#[test]
fn tags_lists_counts_and_typed_flags_excluding_private_notes() {
    let fixture = graph();
    fixture.write_note("notes/dune.md", "# Dune\n#Book\n");
    fixture.write_note("notes/emma.md", "# Emma\n#book #idea\n");
    fixture.write_note("notes/secret.md", "---\nprivate: true\n---\n# S\n#book\n");
    let missing = kore(&fixture, &["tags"]);
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

    let value = json(&kore(&fixture, &["tags", "--json"]));
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

    let human = stdout(&kore(&fixture, &["tags"]));
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

    let value = json(&kore(&fixture, &["list", "--json"]));
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

    let by_tag = json(&kore(
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
    let after = kore(&fixture, &["list", "--tag", "book", "--json"]);
    assert!(!stdout(&after).contains("fresh"), "{}", stdout(&after));
    assert!(stderr(&after).contains("stale"));

    let bad_kind = kore(&fixture, &["list", "--kind", "page"]);
    assert_eq!(bad_kind.status.code(), Some(2), "clap rejects the value");
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
    let value = json(&kore(&fixture, &["properties", "Dune", "--json"]));
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
    let value = json(&kore(&fixture, &["properties", "notes/dune.md", "--json"]));
    assert_eq!(value["tags"], serde_json::json!(["book"]));
    let human = stdout(&kore(&fixture, &["properties", "Dune"]));
    assert!(human.contains("author\tHerbert"), "{human}");
    assert!(human.contains("genres\tscifi, classic"), "{human}");
    assert!(human.contains("tags\t#book"), "{human}");

    let private = kore(&fixture, &["properties", "notes/secret.md"]);
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
    let missing = kore(&fixture, &["links", "Dune"]);
    assert_eq!(missing.status.code(), Some(4));

    fixture.build_index();
    fixture.insert_wiki_link("notes/dune.md", "Frank Herbert", 10);
    fixture.insert_wiki_link("notes/dune.md", "Arrakis", 30);
    fixture.insert_wiki_link("notes/dune.md", "Frank Herbert", 50);
    fixture.insert_wiki_link("notes/dune.md", "Secret", 70);

    let value = json(&kore(&fixture, &["links", "Dune", "--json"]));
    assert_eq!(value["path"], "notes/dune.md");
    let links = value["links"].as_array().unwrap();
    assert_eq!(links.len(), 2, "deduped and private dropped: {value}");
    assert_eq!(links[0]["target"], "Frank Herbert");
    assert_eq!(links[0]["path"], "notes/frank-herbert.md");
    assert_eq!(links[0]["title"], "Frank Herbert");
    assert_eq!(links[1]["target"], "Arrakis");
    assert!(links[1]["path"].is_null());
    assert!(!value.to_string().contains("secret"));

    let human = stdout(&kore(&fixture, &["links", "Dune"]));
    assert!(human.contains("Arrakis\t(unresolved)"), "{human}");

    let private_source = kore(&fixture, &["links", "notes/secret.md"]);
    assert_eq!(private_source.status.code(), Some(3));
}

#[test]
fn a_missed_note_suggests_near_titles_from_the_index() {
    let fixture = graph();
    fixture.write_note("notes/messiah.md", "# Dune Messiah\n");
    fixture.write_note(
        "notes/secret.md",
        "---\nprivate: true\n---\n# Dune Secret\n",
    );
    fixture.build_index();
    let missed = kore(&fixture, &["show", "Dune"]);
    assert_eq!(missed.status.code(), Some(3));
    let message = stderr(&missed);
    assert!(message.contains("did you mean: Dune Messiah"), "{message}");
    assert!(
        !message.contains("Secret"),
        "private title leaked: {message}"
    );
    let no_hint = kore(&fixture, &["set", "Zzz", "a=b"]);
    assert_eq!(no_hint.status.code(), Some(3));
    assert!(!stderr(&no_hint).contains("did you mean"));
}
