//! End-to-end test for `reflect mcp`: a real client session over the real
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
    let output = reflect_stdin(&fixture, &["mcp"], &input);
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
