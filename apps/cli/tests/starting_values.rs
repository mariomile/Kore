//! Starting values for schema fields (Plan 33 B4) from `kore new` and
//! `kore tag`, the writes MCP's `create_note` and type tools go through.

mod common;

use rusqlite::params;

use common::*;

/// The stored schema as core's pass writes it: each `default` validated
/// into `start` (`withStoredStartingValues`).
const INVOICE: &str = r#"[
  {"name":"Number","key":"number","type":"number","default":"next-number",
   "start":{"kind":"next-number"}},
  {"name":"Status","key":"status","type":"status","options":["Draft","Sent"],"default":"Draft",
   "start":{"kind":"fixed","value":"Draft"}},
  {"name":"Issued","key":"issued","type":"date","default":"today","start":{"kind":"today"}}
]"#;

fn number_on(fixture: &Fixture, rel_path: &str, number: f64) {
    fixture
        .index_conn()
        .execute(
            "INSERT INTO note_properties(note_path, key, value, value_type, value_number)
             VALUES(?1, 'number', ?2, 'number', ?3)",
            params![rel_path, number.to_string(), number],
        )
        .unwrap();
}

fn invoices(fixture: &Fixture) {
    fixture.write_note("bills/a.md", "---\nnumber: 41\n---\n# A\n#invoice\n");
    fixture.write_note(
        "bills/secret.md",
        "---\nprivate: true\nnumber: 99\n---\n# S\n#invoice\n",
    );
    fixture.write_note("bills/loose.md", "# Loose\n");
    fixture.build_index();
    fixture.insert_tag("bills/a.md", "invoice");
    fixture.insert_tag("bills/secret.md", "invoice");
    number_on(fixture, "bills/a.md", 41.0);
    number_on(fixture, "bills/secret.md", 99.0);
    fixture.insert_tag_type("invoice", INVOICE);
}

#[test]
fn new_rows_start_with_the_fields_values() {
    let fixture = graph();
    invoices(&fixture);
    let value = json(&kore(
        &fixture,
        &["new", "March", "--tag", "invoice", "--json"],
    ));
    let properties = &value["properties"];
    // One past the highest number, the private note's 99 included, so a
    // number is never handed out twice.
    assert_eq!(properties["number"], 100, "{value}");
    assert_eq!(properties["status"], "Draft");
    assert!(properties["issued"]
        .as_str()
        .is_some_and(|day| day.len() == 10));
    let written = read(&fixture, value["path"].as_str().unwrap());
    assert!(written.contains("number: 100"), "{written}");

    // A value the agent sets wins over the starting value.
    let set = json(&kore(
        &fixture,
        &[
            "new",
            "April",
            "--tag",
            "invoice",
            "--set",
            "status=Sent",
            "--json",
        ],
    ));
    assert_eq!(set["properties"]["status"], "Sent");
}

#[test]
fn tagging_a_note_stamps_it_once() {
    let fixture = graph();
    invoices(&fixture);
    let joined = json(&kore(
        &fixture,
        &["tag", "bills/loose.md", "invoice", "--json"],
    ));
    assert_eq!(joined["added"], true);
    assert_eq!(joined["stamped"]["number"], 100, "{joined}");
    assert_eq!(joined["stamped"]["status"], "Draft");

    // A note already in the tag keeps what it has: no starting values.
    let again = json(&kore(&fixture, &["tag", "bills/a.md", "invoice", "--json"]));
    assert_eq!(again["added"], false);
    assert!(again["stamped"].as_object().unwrap().is_empty(), "{again}");
}

#[test]
fn next_number_counts_a_child_tag_with_a_private_definition() {
    let fixture = graph();
    fixture.write_note("bills/credit.md", "---\nnumber: 120\n---\n# C\n#credit\n");
    invoices(&fixture);
    fixture.insert_tag("bills/credit.md", "credit");
    number_on(&fixture, "bills/credit.md", 120.0);
    // `#credit` builds on `#invoice` but its definition is private: it is in
    // the full child list only, as core's pass stores it.
    fixture
        .index_conn()
        .execute(
            "UPDATE tag_types SET descendants_json = '[\"credit\"]' WHERE tag_key = 'invoice'",
            [],
        )
        .unwrap();

    let value = json(&kore(
        &fixture,
        &["new", "May", "--tag", "invoice", "--json"],
    ));
    // Like the app: the count spans every child, private ones included.
    assert_eq!(value["properties"]["number"], 121, "{value}");
}
