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
