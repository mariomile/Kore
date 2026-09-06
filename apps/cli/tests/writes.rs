//! Integration tests for the CLI's structured writes (Plan 30): `set`,
//! `tag`/`untag`, `done`, `append`, typed `new`, and `capture --stdin`, run
//! against the real binary and fixture graphs.

mod common;

use std::fs;

use common::*;

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

#[test]
fn set_handles_zero_indent_block_sequences_and_refuses_conflicting_flags() {
    let fixture = graph();
    fixture.write_note(
        "notes/seq.md",
        "---\ntitle: Seq\ngenres:\n- a\n- b\n---\n# Seq\n",
    );

    let removed = reflect(&fixture, &["set", "notes/seq.md", "--unset", "genres"]);
    assert_eq!(removed.status.code(), Some(0), "{}", stderr(&removed));
    assert_eq!(
        read(&fixture, "notes/seq.md"),
        "---\ntitle: Seq\n---\n# Seq\n"
    );

    fixture.write_note(
        "notes/seq.md",
        "---\ntitle: Seq\ngenres:\n- a\n- b\n---\n# Seq\n",
    );
    let replaced = reflect(&fixture, &["set", "notes/seq.md", "genres=noir"]);
    assert_eq!(replaced.status.code(), Some(0), "{}", stderr(&replaced));
    assert_eq!(
        read(&fixture, "notes/seq.md"),
        "---\ntitle: Seq\ngenres: noir\n---\n# Seq\n"
    );

    let conflict = reflect(
        &fixture,
        &["set", "notes/seq.md", "genres=x", "--unset", "genres"],
    );
    assert_eq!(conflict.status.code(), Some(2));
    assert_eq!(
        read(&fixture, "notes/seq.md"),
        "---\ntitle: Seq\ngenres: noir\n---\n# Seq\n"
    );
}

#[test]
fn done_never_toggles_a_task_sample_inside_a_code_fence() {
    let fixture = graph();
    fixture.write_note(
        "notes/tasks.md",
        "# Tasks\n+ [ ] something else\n\nExample:\n```md\n+ [ ] pay bill\n```\n",
    );
    fixture.build_index();
    // A drifted index still lists the real task that the user edited away.
    fixture.insert_task("notes/tasks.md", 10, "pay bill", false, None, None);

    let drifted = reflect(&fixture, &["done", "pay bill"]);
    assert_eq!(drifted.status.code(), Some(1), "{}", stderr(&drifted));
    assert!(stderr(&drifted).contains("no longer matches"));
    assert!(read(&fixture, "notes/tasks.md").contains("```md\n+ [ ] pay bill\n```"));
}

#[test]
fn values_a_command_cannot_honour_are_usage_errors() {
    let fixture = graph();
    fixture.write_note("notes/a.md", "# A\n");
    fixture.build_index();
    assert_eq!(
        reflect(&fixture, &["list", "--kind", "page"]).status.code(),
        Some(2)
    );
    assert_eq!(reflect(&fixture, &["new", "   "]).status.code(), Some(2));
    assert_eq!(reflect(&fixture, &["set", "A"]).status.code(), Some(2));
}
