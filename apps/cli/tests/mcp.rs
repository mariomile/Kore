//! End-to-end test for `kore mcp`: a real client session over the real
//! binary's stdio against a fixture graph.

mod common;

use serde_json::{json, Value};

use common::*;

#[test]
fn an_mcp_session_searches_reads_and_writes_while_private_notes_stay_hidden() {
    let fixture = graph();
    fixture.write_note("notes/zebra.md", "# Zebra Migration\nzebra plans\n");
    fixture.write_note(
        "notes/secret.md",
        "---\nprivate: true\n---\n# Secret\nzebra zebra\n",
    );
    fixture.build_index();

    let messages = [
        json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": { "protocolVersion": "2025-06-18", "capabilities": {},
                        "clientInfo": { "name": "test", "version": "0" } } }),
        json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }),
        json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/call",
            "params": { "name": "search", "arguments": { "query": "zebra" } } }),
        json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/call",
            "params": { "name": "read_note", "arguments": { "note": "Secret" } } }),
        json!({ "jsonrpc": "2.0", "id": 4, "method": "tools/call",
            "params": { "name": "append_to_note",
                        "arguments": { "note": "Zebra Migration", "markdown": "- step one\n- step two" } } }),
    ];
    let input: String = messages
        .iter()
        .map(|message| format!("{message}\n"))
        .collect();
    let output = kore_stdin(&fixture, &["mcp"], &input);
    assert!(output.status.success(), "stderr: {}", stderr(&output));

    let replies: Vec<Value> = stdout(&output)
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(replies.len(), 4, "the notification gets no reply");
    assert_eq!(replies[0]["result"]["serverInfo"]["name"], "kore");

    let search = &replies[1]["result"];
    assert_eq!(search["isError"], false);
    let hits = search["content"][0]["text"].as_str().unwrap();
    assert!(hits.contains("notes/zebra.md"));
    assert!(!hits.contains("secret"));

    assert_eq!(replies[2]["result"]["isError"], true);
    assert!(!replies[2]["result"]["content"][0]["text"]
        .as_str()
        .unwrap()
        .contains("zebra zebra"));

    assert_eq!(replies[3]["result"]["isError"], false);
    assert!(read(&fixture, "notes/zebra.md").ends_with("- step one\n- step two\n"));
}

#[test]
fn notes_are_resources_and_prompts_under_read_only_and_private_notes_stay_hidden() {
    let fixture = graph();
    fixture.write_note(
        "notes/zebra.md",
        "---\nid: 01hzy3v9k2m4n6p8q0r2s4t6vw\n---\n# Zebra Migration\nsee [[Plan B]]\n",
    );
    fixture.write_note("notes/plan b.md", "# Plan B\nfallback\n");
    fixture.write_note(
        "notes/secret.md",
        "---\nprivate: true\n---\n# Secret\nzebra zebra\n",
    );
    fixture.build_index();
    fixture.insert_wiki_link("notes/zebra.md", "Plan B", 0);

    let messages = [
        json!({ "jsonrpc": "2.0", "id": 1, "method": "resources/list" }),
        json!({ "jsonrpc": "2.0", "id": 2, "method": "resources/read",
            "params": { "uri": "kore://note/notes%2Fplan%20b.md" } }),
        json!({ "jsonrpc": "2.0", "id": 3, "method": "resources/read",
            "params": { "uri": "kore://note/01hzy3v9k2m4n6p8q0r2s4t6vw" } }),
        json!({ "jsonrpc": "2.0", "id": 4, "method": "resources/read",
            "params": { "uri": "kore://note/notes%2Fsecret.md" } }),
        json!({ "jsonrpc": "2.0", "id": 5, "method": "prompts/get",
            "params": { "name": "connect_note", "arguments": { "note": "Zebra Migration" } } }),
        json!({ "jsonrpc": "2.0", "id": 6, "method": "prompts/get",
            "params": { "name": "connect_note", "arguments": { "note": "Secret" } } }),
    ];
    let input: String = messages
        .iter()
        .map(|message| format!("{message}\n"))
        .collect();
    let output = kore_stdin(&fixture, &["mcp", "--read-only"], &input);
    assert!(output.status.success(), "stderr: {}", stderr(&output));
    let replies: Vec<Value> = stdout(&output)
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();

    let uris: Vec<&str> = replies[0]["result"]["resources"]
        .as_array()
        .unwrap()
        .iter()
        .map(|resource| resource["uri"].as_str().unwrap())
        .collect();
    assert!(uris.contains(&"kore://note/notes%2Fzebra.md"));
    assert!(uris.contains(&"kore://note/notes%2Fplan%20b.md"));
    assert!(!uris.iter().any(|uri| uri.contains("secret")));

    assert_eq!(
        replies[1]["result"]["contents"][0]["text"],
        "# Plan B\nfallback\n"
    );
    let by_id = replies[2]["result"]["contents"][0]["text"]
        .as_str()
        .unwrap();
    assert!(
        by_id.contains("# Zebra Migration"),
        "an app deep link reads back"
    );

    assert_eq!(replies[3]["error"]["code"], -32002);
    assert!(!replies[3].to_string().contains("zebra zebra"));

    let prompt = replies[4]["result"]["messages"].as_array().unwrap();
    assert!(prompt[0]["content"]["resource"]["text"]
        .as_str()
        .unwrap()
        .contains("# Zebra Migration"));
    assert!(prompt[1]["content"]["text"]
        .as_str()
        .unwrap()
        .contains("Plan B (kore://note/notes%2Fplan%20b.md)"));

    assert_eq!(replies[5]["error"]["code"], -32602);
    assert!(!replies[5].to_string().contains("zebra zebra"));
}
