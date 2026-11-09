//! End-to-end tests for `kore proposals` (Plan 33, A2): the writes an agent
//! with a "propose" key asked for, kept for the owner.

mod common;

use std::io::Write;
use std::process::{Command, Output, Stdio};

use serde_json::{json, Value};

use common::*;

/// Run the binary the way `kore mcp` runs a tool call: optionally as an
/// agent (its env), with `input` on stdin.
fn kore_as(fixture: &Fixture, agent: Option<&str>, args: &[&str], input: &str) -> Output {
    let mut command = Command::new(env!("CARGO_BIN_EXE_kore"));
    command
        .arg("--json")
        .args(args)
        .current_dir(fixture.root())
        .env_remove("KORE_GRAPH")
        .env_remove("KORE_AGENT")
        .env_remove("KORE_AGENT_EMAIL")
        .env_remove("KORE_AGENT_GRAPH")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(agent) = agent {
        command
            .env("KORE_AGENT", agent)
            .env("KORE_AGENT_EMAIL", "ignored@agents.kore")
            .env("KORE_AGENT_GRAPH", fixture.root());
    }
    let mut child = command.spawn().unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(input.as_bytes())
        .unwrap();
    child.wait_with_output().unwrap()
}

fn waiting(fixture: &Fixture) -> Vec<Value> {
    let output = kore_as(fixture, None, &["proposals"], "");
    assert!(output.status.success(), "stderr: {}", stderr(&output));
    serde_json::from_str::<Value>(&stdout(&output))
        .unwrap()
        .as_array()
        .unwrap()
        .clone()
}

#[test]
fn an_agents_tool_call_is_kept_signed_by_the_process_not_the_input() {
    let fixture = graph();
    let call = json!({ "tool": "capture", "arguments": { "text": "buy milk" } }).to_string();
    let output = kore_as(&fixture, Some("Grok"), &["proposals", "add"], &call);
    assert!(output.status.success(), "stderr: {}", stderr(&output));

    let waiting = waiting(&fixture);
    assert_eq!(waiting.len(), 1);
    assert_eq!(waiting[0]["agent"]["name"], "Grok");
    assert_eq!(waiting[0]["agent"]["email"], "grok@agents.kore");
    assert_eq!(waiting[0]["call"]["tool"], "capture");
    assert_eq!(waiting[0]["call"]["arguments"]["text"], "buy milk");
}

#[test]
fn a_forged_agent_a_non_agent_or_a_bad_call_is_never_kept() {
    let fixture = graph();
    let forged = json!({ "tool": "capture", "arguments": { "text": "x" },
                         "agent": { "name": "Owner", "email": "me@example.com" } })
    .to_string();
    let call = json!({ "tool": "capture", "arguments": { "text": "x" } }).to_string();
    let read = json!({ "tool": "search", "arguments": { "query": "x" } }).to_string();
    let invalid = json!({ "tool": "capture", "arguments": {} }).to_string();

    for (agent, input) in [
        (Some("Grok"), forged.as_str()),
        (None, call.as_str()),
        (Some("Grok"), read.as_str()),
        (Some("Grok"), invalid.as_str()),
    ] {
        let output = kore_as(&fixture, agent, &["proposals", "add"], input);
        assert!(!output.status.success(), "kept {input} for {agent:?}");
    }
    assert!(waiting(&fixture).is_empty());
}

fn propose(fixture: &Fixture, call: Value) -> String {
    let output = kore_as(
        fixture,
        Some("Grok"),
        &["proposals", "add"],
        &call.to_string(),
    );
    assert!(output.status.success(), "stderr: {}", stderr(&output));
    json(&output)["id"].as_str().unwrap().to_string()
}

#[test]
fn accepting_writes_the_call_as_the_agent_and_rejecting_writes_nothing() {
    let fixture = graph();
    let kept = propose(
        &fixture,
        json!({ "tool": "create_note", "arguments": { "title": "Milk", "body": "buy milk" } }),
    );
    let dropped = propose(
        &fixture,
        json!({ "tool": "create_note", "arguments": { "title": "Eggs", "body": "buy eggs" } }),
    );
    assert!(!fixture.root().join("Milk.md").exists());

    let output = kore_as(&fixture, None, &["proposals", "reject", &dropped], "");
    assert!(output.status.success(), "stderr: {}", stderr(&output));
    let output = kore_as(&fixture, None, &["proposals", "accept", &kept], "");
    assert!(output.status.success(), "stderr: {}", stderr(&output));
    assert_eq!(json(&output)["accepted"], true);

    assert!(waiting(&fixture).is_empty());
    let notes = std::fs::read_dir(fixture.root().join("notes"))
        .unwrap()
        .map(|entry| std::fs::read_to_string(entry.unwrap().path()).unwrap())
        .collect::<Vec<_>>()
        .concat();
    assert!(notes.contains("buy milk"), "{notes}");
    assert!(!notes.contains("buy eggs"), "{notes}");
    let journal = read(&fixture, ".reflect/agent-writes.jsonl");
    assert!(journal.contains("\"agent\":\"Grok\""), "{journal}");
}

#[test]
fn only_the_owner_decides_and_only_on_a_proposal_that_exists() {
    let fixture = graph();
    let id = propose(
        &fixture,
        json!({ "tool": "capture", "arguments": { "text": "x" } }),
    );
    for verb in ["accept", "reject"] {
        let output = kore_as(&fixture, Some("Grok"), &["proposals", verb, &id], "");
        assert!(!output.status.success(), "an agent could {verb}");
        let output = kore_as(&fixture, None, &["proposals", verb, "0000-missing"], "");
        assert!(!output.status.success(), "{verb} of a missing proposal");
    }
    assert_eq!(waiting(&fixture).len(), 1);
}
