//! `kore collection` over tags that build on other tags (Plan 33 B2). Core
//! stores the inheritance results in `tag_types`; the CLI only reads them, so
//! these fixtures write the columns core's pass would have written.

mod common;

use rusqlite::{params, Connection};

use common::*;

/// One definition row: its tag, own schema, the stored pass results, privacy.
struct Definition<'a> {
    tag: &'a str,
    schema: &'a str,
    resolved: Option<&'a str>,
    public_resolved: Option<&'a str>,
    public_descendants: &'a str,
    private: bool,
}

fn open(fixture: &Fixture) -> Connection {
    Connection::open(fixture.root().join(".reflect").join("index.sqlite")).unwrap()
}

fn tag_note(conn: &Connection, path: &str, tag: &str) {
    conn.execute(
        "INSERT INTO tags(note_path, tag, tag_key) VALUES(?1, ?2, ?2)",
        params![path, tag],
    )
    .unwrap();
}

fn define(conn: &Connection, definition: &Definition<'_>) {
    let path = format!("tags/{}.md", definition.tag);
    conn.execute(
        "INSERT INTO notes(path, id, title, title_key, kind, is_private, is_pinned,
                           file_hash, mtime, updated_at, preview)
         VALUES(?1, ?2, ?3, ?3, 'tag', ?4, 0, 'x', 0, 0, '')",
        params![
            path,
            format!("tag-{}", definition.tag),
            definition.tag,
            i64::from(definition.private)
        ],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO tag_types(tag_key, note_path, schema_json, resolved_json,
                               public_resolved_json, descendants_json, public_descendants_json)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        params![
            definition.tag,
            path,
            definition.schema,
            definition.resolved,
            definition.public_resolved,
            definition.public_descendants
        ],
    )
    .unwrap();
}

fn schema_keys(value: &serde_json::Value) -> Vec<String> {
    value["schema"]
        .as_array()
        .unwrap()
        .iter()
        .map(|property| property["key"].as_str().unwrap().to_string())
        .collect()
}

fn note_paths(value: &serde_json::Value) -> Vec<String> {
    let mut paths: Vec<String> = value["notes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|note| note["path"].as_str().unwrap().to_string())
        .collect();
    paths.sort_unstable();
    paths
}

const EMAIL: &str = r#"[{"name":"Email","key":"email","type":"text"}]"#;
const CONTRACT: &str =
    r#"{"properties":[{"name":"Contract","key":"contract","type":"text"}],"extends":["contact"]}"#;
const EMAIL_AND_CONTRACT: &str = r#"{"properties":[{"name":"Email","key":"email","type":"text"},{"name":"Contract","key":"contract","type":"text"}],"extends":["contact"]}"#;

/// `#contact` with `#client` built on it, three people, one under `#client/vip`.
fn crm(fixture: &Fixture, contact_private: bool) {
    fixture.write_note("people/ada.md", "# Ada\n#contact\n");
    fixture.write_note("people/acme.md", "# Acme\n#client\n");
    fixture.write_note("people/vip.md", "# Vip\n#client/vip\n");
    fixture.build_index();
    let conn = open(fixture);
    tag_note(&conn, "people/ada.md", "contact");
    tag_note(&conn, "people/acme.md", "client");
    tag_note(&conn, "people/vip.md", "client/vip");
    define(
        &conn,
        &Definition {
            tag: "contact",
            schema: EMAIL,
            resolved: Some(EMAIL),
            public_resolved: if contact_private { None } else { Some(EMAIL) },
            public_descendants: if contact_private {
                "[]"
            } else {
                r#"["client"]"#
            },
            private: contact_private,
        },
    );
    define(
        &conn,
        &Definition {
            tag: "client",
            schema: CONTRACT,
            resolved: Some(EMAIL_AND_CONTRACT),
            public_resolved: Some(if contact_private {
                CONTRACT
            } else {
                EMAIL_AND_CONTRACT
            }),
            public_descendants: "[]",
            private: false,
        },
    );
}

#[test]
fn collection_reads_the_stored_effective_schema() {
    let fixture = graph();
    crm(&fixture, false);
    let client = json(&kore(&fixture, &["collection", "client", "--json"]));
    assert_eq!(schema_keys(&client), ["email", "contract"], "{client}");
}

#[test]
fn collection_lists_child_and_nested_child_rows_under_the_parent() {
    let fixture = graph();
    crm(&fixture, false);
    let contact = json(&kore(&fixture, &["collection", "contact", "--json"]));
    assert_eq!(
        note_paths(&contact),
        ["people/acme.md", "people/ada.md", "people/vip.md"],
        "{contact}"
    );
    // The child's own collection counts its nested tag too.
    let client = json(&kore(&fixture, &["collection", "client", "--json"]));
    assert_eq!(note_paths(&client), ["people/acme.md", "people/vip.md"]);
}

#[test]
fn a_private_parent_reaches_no_agent() {
    let fixture = graph();
    crm(&fixture, true);
    // The public child carries only its own fields.
    let client = json(&kore(&fixture, &["collection", "client", "--json"]));
    assert_eq!(schema_keys(&client), ["contract"], "{client}");
    assert!(
        !client.to_string().contains("email"),
        "private field leak: {client}"
    );
    // The private definition is no type at all.
    let contact = kore(&fixture, &["collection", "contact"]);
    assert_eq!(contact.status.code(), Some(3), "{}", stderr(&contact));
}

#[test]
fn before_cores_first_pass_the_own_schema_stands_in() {
    let fixture = graph();
    fixture.write_note("people/acme.md", "# Acme\n#client\n");
    fixture.build_index();
    let conn = open(&fixture);
    tag_note(&conn, "people/acme.md", "client");
    define(
        &conn,
        &Definition {
            tag: "client",
            schema: CONTRACT,
            resolved: None,
            public_resolved: None,
            public_descendants: "[]",
            private: false,
        },
    );
    drop(conn);
    let client = json(&kore(&fixture, &["collection", "client", "--json"]));
    assert_eq!(schema_keys(&client), ["contract"]);
}
