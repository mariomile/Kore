//! `kore search` hybrid/semantic legs and `kore edit`, through the real
//! binary. The model-free tests run everywhere; the end-to-end semantic test
//! needs a real MiniLM-shaped ONNX model in `KORE_TEST_MODEL_DIR` (CI and the
//! cloud containers cannot download one) and is skipped without it.

mod common;

use std::fs;
use std::path::PathBuf;

use common::{graph, json, kore, kore_env, stderr, Fixture};
use kore_cli::embed::{Embedder, MODEL_ID};

/// A unit vector along one axis: enough for the model-free tests, which
/// never get as far as comparing vectors.
fn axis(index: usize) -> Vec<f32> {
    let mut vector = vec![0.0; 384];
    vector[index] = 1.0;
    vector
}

fn fixture_with_vectors() -> Fixture {
    let fixture = graph();
    fixture.write_note("notes/pricing.md", "# Pricing\nWe charge per seat.\n");
    fixture.write_note("notes/garden.md", "# Garden\nTomatoes and basil.\n");
    fixture.build_index();
    fixture.insert_chunk(
        "notes/pricing.md",
        None,
        "We charge per seat.",
        MODEL_ID,
        &axis(0),
    );
    fixture.insert_chunk(
        "notes/garden.md",
        None,
        "Tomatoes and basil.",
        MODEL_ID,
        &axis(1),
    );
    fixture
}

#[test]
fn hybrid_falls_back_to_lexical_without_a_semantic_index() {
    let fixture = graph();
    fixture.write_note("notes/a.md", "# Alpha\nsearchable text\n");
    fixture.build_index();
    let home = tempfile::tempdir().unwrap();

    let output = kore_env(
        &fixture,
        &["search", "searchable", "--json"],
        &[("HOME", home.path())],
    );
    assert!(output.status.success(), "stderr: {}", stderr(&output));
    let value = json(&output);
    assert_eq!(value["mode"], "lexical");
    assert!(value["semanticUnavailable"]
        .as_str()
        .unwrap()
        .contains("no semantic index"));
    assert_eq!(value["results"][0]["path"], "notes/a.md");
    assert!(stderr(&output).contains("showing lexical results only"));
}

#[test]
fn hybrid_falls_back_to_lexical_without_the_model() {
    let fixture = fixture_with_vectors();
    let home = tempfile::tempdir().unwrap();
    let empty = tempfile::tempdir().unwrap();

    let output = kore_env(
        &fixture,
        &["search", "seat", "--json"],
        &[("HOME", home.path()), ("KORE_MODEL_DIR", empty.path())],
    );
    assert!(output.status.success(), "stderr: {}", stderr(&output));
    let value = json(&output);
    assert_eq!(value["mode"], "lexical");
    assert!(value["semanticUnavailable"]
        .as_str()
        .unwrap()
        .contains("model is not on this machine"));
    assert_eq!(value["results"][0]["path"], "notes/pricing.md");
}

#[test]
fn semantic_mode_is_an_error_when_semantic_search_is_unavailable() {
    let fixture = fixture_with_vectors();
    let home = tempfile::tempdir().unwrap();

    let output = kore_env(
        &fixture,
        &["search", "seat", "--mode", "semantic"],
        &[("HOME", home.path())],
    );
    assert_eq!(output.status.code(), Some(1));
    assert!(stderr(&output).contains("semantic search is unavailable"));
}

#[test]
fn lexical_mode_never_looks_for_the_model() {
    let fixture = fixture_with_vectors();
    let home = tempfile::tempdir().unwrap();

    let output = kore_env(
        &fixture,
        &["search", "seat", "--mode", "lexical", "--json"],
        &[("HOME", home.path())],
    );
    assert!(output.status.success());
    let value = json(&output);
    assert_eq!(value["mode"], "lexical");
    assert!(value.get("semanticUnavailable").is_none());
    assert_eq!(stderr(&output), "");
}

#[test]
fn filters_alone_need_no_embedding() {
    let fixture = fixture_with_vectors();
    let home = tempfile::tempdir().unwrap();

    let output = kore_env(
        &fixture,
        &["search", "path:notes/", "--json"],
        &[("HOME", home.path())],
    );
    let value = json(&output);
    assert_eq!(value["mode"], "lexical");
    assert!(value.get("semanticUnavailable").is_none());
    assert_eq!(value["results"].as_array().unwrap().len(), 2);
}

/// The model the end-to-end test runs, when one is supplied.
fn test_model() -> Option<PathBuf> {
    std::env::var_os("KORE_TEST_MODEL_DIR").map(PathBuf::from)
}

#[test]
fn semantic_search_ranks_by_meaning_and_keeps_private_notes_out() {
    let Some(model) = test_model() else {
        return;
    };
    let embedder = Embedder::load(&model).unwrap();
    let fixture = graph();
    let texts = [
        (
            "notes/fox.md",
            "the quick brown fox jumps over the lazy dog",
        ),
        ("notes/vault.md", "kore vault memory agent search"),
        ("notes/mario.md", "cosa so di mario progetto roma"),
    ];
    for (path, text) in texts {
        fixture.write_note(path, &format!("# {path}\n{text}\n"));
    }
    // Identical text in a private note and in a template: neither may surface.
    fixture.write_note(
        "notes/secret.md",
        "---\nprivate: true\n---\n# Secret\nkore vault memory agent search\n",
    );
    fixture.build_index();
    for (path, text) in texts {
        fixture.insert_chunk(
            path,
            Some("Body"),
            text,
            MODEL_ID,
            &embedder.embed(text).unwrap(),
        );
    }
    let secret = "kore vault memory agent search";
    fixture.insert_chunk(
        "notes/secret.md",
        None,
        secret,
        MODEL_ID,
        &embedder.embed(secret).unwrap(),
    );
    let home = tempfile::tempdir().unwrap();
    let envs = [("HOME", home.path()), ("KORE_MODEL_DIR", model.as_path())];

    let output = kore_env(
        &fixture,
        &[
            "search",
            "kore vault memory agent search",
            "--mode",
            "semantic",
            "--json",
        ],
        &envs,
    );
    assert!(output.status.success(), "stderr: {}", stderr(&output));
    let value = json(&output);
    assert_eq!(value["mode"], "semantic");
    let results = value["results"].as_array().unwrap();
    assert_eq!(results[0]["path"], "notes/vault.md");
    assert_eq!(results[0]["heading"], "Body");
    assert!(results[0]["score"].as_f64().unwrap() > 0.99);
    assert!(results.iter().all(|hit| hit["path"] != "notes/secret.md"));

    // Hybrid: the note both legs find ranks first.
    let output = kore_env(&fixture, &["search", "cosa so di mario", "--json"], &envs);
    assert!(output.status.success(), "stderr: {}", stderr(&output));
    let value = json(&output);
    assert_eq!(value["mode"], "hybrid");
    assert_eq!(value["results"][0]["path"], "notes/mario.md");

    // Filters constrain the semantic leg too.
    let output = kore_env(
        &fixture,
        &[
            "search",
            "kore vault memory agent search -path:notes/vault",
            "--json",
        ],
        &envs,
    );
    assert!(output.status.success(), "stderr: {}", stderr(&output));
    let value = json(&output);
    assert!(value["results"]
        .as_array()
        .unwrap()
        .iter()
        .all(|hit| hit["path"] != "notes/vault.md"));
}

#[test]
fn a_mismatched_model_turns_semantic_search_off() {
    let Some(model) = test_model() else {
        return;
    };
    let fixture = graph();
    fixture.write_note(
        "notes/a.md",
        "# A\nthe quick brown fox jumps over the lazy dog\n",
    );
    fixture.build_index();
    // A stored vector the model would never produce for this text.
    fixture.insert_chunk(
        "notes/a.md",
        None,
        "the quick brown fox jumps over the lazy dog",
        MODEL_ID,
        &axis(7),
    );
    let home = tempfile::tempdir().unwrap();
    let output = kore_env(
        &fixture,
        &["search", "fox", "--json"],
        &[("HOME", home.path()), ("KORE_MODEL_DIR", model.as_path())],
    );
    let value = json(&output);
    assert_eq!(value["mode"], "lexical");
    assert!(value["semanticUnavailable"]
        .as_str()
        .unwrap()
        .contains("do not match the app's"));
}

// ---- kore edit --------------------------------------------------------------

#[test]
fn edit_replaces_one_passage_and_reports_it() {
    let fixture = graph();
    let note = fixture.write_note(
        "notes/plan.md",
        "---\nstatus: draft\n---\n# Plan\n\nShip in May.\nThen rest.\n",
    );
    let output = kore(
        &fixture,
        &[
            "edit",
            "notes/plan.md",
            "--old",
            "Ship in May.",
            "--new",
            "Ship in June.",
            "--json",
        ],
    );
    assert!(output.status.success(), "stderr: {}", stderr(&output));
    let value = json(&output);
    assert_eq!(value["path"], "notes/plan.md");
    assert_eq!(value["appended"], false);
    assert_eq!(
        fs::read_to_string(&note).unwrap(),
        "---\nstatus: draft\n---\n# Plan\n\nShip in June.\nThen rest.\n"
    );
}

#[test]
fn edit_writes_nothing_when_the_expected_text_moved_on() {
    let fixture = graph();
    let before = "# Plan\n\nShip in July.\n";
    let note = fixture.write_note("notes/plan.md", before);
    let output = kore(
        &fixture,
        &[
            "edit",
            "Plan",
            "--old",
            "Ship in May.",
            "--new",
            "Ship in June.",
        ],
    );
    assert_eq!(output.status.code(), Some(2));
    assert!(stderr(&output).contains("not found"));
    assert_eq!(fs::read_to_string(&note).unwrap(), before);

    let repeated = "# Plan\n\nx\nx\n";
    fs::write(&note, repeated).unwrap();
    let output = kore(
        &fixture,
        &["edit", "notes/plan.md", "--old", "x", "--new", "y"],
    );
    assert_eq!(output.status.code(), Some(2));
    assert!(stderr(&output).contains("more than once"));
    assert_eq!(fs::read_to_string(&note).unwrap(), repeated);
}

#[test]
fn edit_appends_with_an_empty_old_text() {
    let fixture = graph();
    let note = fixture.write_note("notes/log.md", "# Log\n- one\n");
    let output = kore(
        &fixture,
        &[
            "edit",
            "notes/log.md",
            "--old=",
            "--new",
            "- two\n",
            "--json",
        ],
    );
    assert!(output.status.success(), "stderr: {}", stderr(&output));
    assert_eq!(json(&output)["appended"], true);
    assert_eq!(fs::read_to_string(&note).unwrap(), "# Log\n- one\n- two\n");
}

#[test]
fn edit_refuses_a_private_note() {
    let fixture = graph();
    let before = "---\nprivate: true\n---\n# Secret\nold\n";
    let note = fixture.write_note("notes/secret.md", before);
    let output = kore(
        &fixture,
        &["edit", "notes/secret.md", "--old", "old", "--new", "new"],
    );
    assert_eq!(output.status.code(), Some(3));
    assert!(stderr(&output).contains("private"));
    assert_eq!(fs::read_to_string(&note).unwrap(), before);
}
