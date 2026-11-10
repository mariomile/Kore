//! `kore mcp` — the CLI as a Model Context Protocol server over stdio, so
//! any MCP client (Claude Desktop, Claude Code, Cursor, Codex…) can search,
//! read, and write a Kore graph as tools.
//!
//! Each tool is one existing subcommand run as a child process of this same
//! binary with `--graph <root> --json`, so the server inherits the CLI's
//! contracts unchanged: the `--json` shapes in `docs/cli.md`, the structural
//! writes, and the privacy rule (a `private: true` note is invisible here
//! exactly as it is to `kore show`). The server adds no reading or writing
//! logic of its own; it only maps tool arguments to argv. Values travel as
//! separate argv entries after `--`, never through a shell, so a query that
//! starts with `-` stays a query.
//!
//! Resources and prompts ride the same runner. Every note is a resource
//! addressed by the app's own deep link (`kore://note/<path>`), so a URI an
//! agent reads is one the user can click to open the note in Kore, and a link
//! copied from the app (`kore://note/<id>`, `kore://daily/<date>`) reads back
//! here. Prompts gather notes the same way and only ever ask the model to
//! read, so `--read-only` keeps all of them.
//!
//! Transport: newline-delimited JSON-RPC 2.0 on stdin/stdout (the MCP stdio
//! transport). stdout carries protocol messages only; nothing else is printed.

use crate::agent_identity::AgentIdentity;
use crate::agent_keys::Access;
use std::io::{self, BufRead, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};

use serde_json::{json, Map, Value};

pub mod propose;
mod tools;
use tools::*;

/// Protocol revisions this server speaks, newest first. A client asking for
/// one of these gets it back; anything else gets the newest.
const PROTOCOL_VERSIONS: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS: &str = "Tools over the user's Kore notes: a local folder of \
Markdown files with [[wiki links]], #tags, frontmatter properties, tasks, and one \
daily note per day. A <note> argument accepts a YYYY-MM-DD date, a graph-relative \
path, a note id, a title, or an alias. Search first (it matches meaning as well as words, so ask in plain \
language), then read_note what you need. Notes the user marked private are never \
returned. Writes are structural: they append, create, set one property, or replace one \
passage whose exact current text you pass (edit_note), so nothing overwrites a change \
you have not read. Every note is also a resource \
at kore://note/<path>, a link that opens it in the Kore app. Call vault_guide first: \
it returns the vault's own agent contract (its rules, including where memory and new \
notes go) and a map of its folders. To keep a durable fact for every agent that \
uses this vault, call remember: it signs the fact with your name and the date, and keeps \
the old value when a fact changes.";

/// Contract text inlined into `instructions` beyond this is left to
/// `vault_guide`: clients paste instructions into every session's context.
const INSTRUCTIONS_CONTRACT_MAX_CHARS: usize = 12_000;

/// `resources/list` page size. Notes come newest first, so the notes a user
/// is most likely to attach are on the first page.
const RESOURCE_PAGE: usize = 1000;

/// Most notes the weekly review lists as changed this week.
const WEEKLY_CHANGED_CAP: usize = 200;

/// JSON-RPC error for a resource that does not resolve (or is private).
const RESOURCE_NOT_FOUND: i64 = -32002;

/// What one subcommand run produced.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunOutput {
    pub success: bool,
    /// stdout on success, otherwise the error message from stderr.
    pub text: String,
}

/// Runs a `kore` subcommand. The process runner is the real one; tests
/// substitute a recorder.
pub trait Runner {
    /// `args` start at the subcommand name; `--graph` and `--json` are the
    /// runner's business. `stdin` is piped to the child when present.
    fn run(&self, args: &[String], stdin: Option<&str>) -> RunOutput;

    /// Run a tool call on behalf of `agent`, so a runner that records writes
    /// can sign them as that agent ([`Runner::run`] is the vault's owner).
    /// Runners that record nothing just run.
    fn run_as(&self, args: &[String], stdin: Option<&str>, agent: &AgentIdentity) -> RunOutput {
        let _ = agent;
        self.run(args, stdin)
    }
}

/// Spawns this binary against one graph.
pub struct ProcessRunner {
    pub exe: PathBuf,
    pub graph: PathBuf,
}

impl Runner for ProcessRunner {
    fn run(&self, args: &[String], stdin: Option<&str>) -> RunOutput {
        self.spawn(args, stdin, None)
    }

    /// A tool call: the child records the notes it writes as this agent's.
    fn run_as(&self, args: &[String], stdin: Option<&str>, agent: &AgentIdentity) -> RunOutput {
        self.spawn(args, stdin, Some(agent))
    }
}

impl ProcessRunner {
    fn spawn(
        &self,
        args: &[String],
        stdin: Option<&str>,
        agent: Option<&AgentIdentity>,
    ) -> RunOutput {
        let mut command = Command::new(&self.exe);
        match agent {
            Some(agent) => command
                .env(crate::write::AGENT_ENV, &agent.name)
                .env(crate::write::AGENT_EMAIL_ENV, &agent.email)
                .env(crate::write::AGENT_GRAPH_ENV, &self.graph),
            None => command
                .env_remove(crate::write::AGENT_ENV)
                .env_remove(crate::write::AGENT_EMAIL_ENV)
                .env_remove(crate::write::AGENT_GRAPH_ENV),
        };
        command
            .arg("--graph")
            .arg(&self.graph)
            .arg("--json")
            .args(args)
            .stdin(if stdin.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env_remove("KORE_GRAPH");
        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(err) => {
                return RunOutput {
                    success: false,
                    text: format!("could not run kore: {err}"),
                }
            }
        };
        if let (Some(input), Some(mut pipe)) = (stdin, child.stdin.take()) {
            // A write error surfaces as the child's own failure below.
            let _ = pipe.write_all(input.as_bytes());
        }
        match child.wait_with_output() {
            Ok(output) if output.status.success() => RunOutput {
                success: true,
                text: String::from_utf8_lossy(&output.stdout).into_owned(),
            },
            Ok(output) => {
                let message = String::from_utf8_lossy(&output.stderr);
                let message = message.trim().trim_start_matches("kore: ");
                RunOutput {
                    success: false,
                    text: if message.is_empty() {
                        format!("kore exited with {}", output.status)
                    } else {
                        message.to_string()
                    },
                }
            }
            Err(err) => RunOutput {
                success: false,
                text: format!("could not run kore: {err}"),
            },
        }
    }
}

fn tool_text(text: String, is_error: bool) -> Value {
    json!({ "content": [{ "type": "text", "text": text }], "isError": is_error })
}

/// `encodeURIComponent`, so a URI built here is byte-for-byte the app's
/// `noteDeepLink` for the same path.
pub(crate) fn encode_component(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

pub(crate) fn decode_component(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = std::str::from_utf8(bytes.get(index + 1..index + 3)?).ok()?;
            decoded.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

/// The deep link for a graph-relative path.
fn note_uri(path: &str) -> String {
    format!("kore://note/{}", encode_component(path))
}

/// What a `kore://` resource URI reads: argv for a subcommand whose `--json`
/// output is a note (`show`/`today`), or the open-tasks list.
enum ResourceTarget {
    Note(Vec<String>),
    Tasks,
    Guide,
}

fn resource_target(uri: &str) -> Option<ResourceTarget> {
    let rest = uri.strip_prefix("kore://")?;
    let rest = rest.split(['?', '#']).next().unwrap_or(rest);
    let show = |target: String| {
        (!target.trim().is_empty())
            .then(|| ResourceTarget::Note(vec!["show".into(), "--".into(), target]))
    };
    match rest.split_once('/') {
        None if rest == "today" => Some(ResourceTarget::Note(vec!["today".into()])),
        None if rest == "tasks" => Some(ResourceTarget::Tasks),
        None if rest == "guide" => Some(ResourceTarget::Guide),
        Some(("note", target)) => show(decode_component(target)?),
        Some(("daily", date)) => show(decode_component(date)?),
        _ => None,
    }
}

fn resource_templates() -> Value {
    json!([
        {
            "uriTemplate": "kore://note/{note}",
            "name": "note",
            "title": "Note",
            "description": "A note by graph-relative path, frontmatter id, title, or alias (URI-encoded). The same link opens the note in Kore.",
            "mimeType": "text/markdown"
        },
        {
            "uriTemplate": "kore://daily/{date}",
            "name": "daily",
            "title": "Daily note",
            "description": "The daily note for a YYYY-MM-DD date.",
            "mimeType": "text/markdown"
        }
    ])
}

/// Resources that are not a single note, listed ahead of the notes.
fn fixed_resources() -> Vec<Value> {
    vec![
        json!({
            "uri": "kore://today",
            "name": "today",
            "title": "Today",
            "description": "Today's daily note. Missing until something is written to it today.",
            "mimeType": "text/markdown"
        }),
        json!({
            "uri": "kore://tasks",
            "name": "tasks",
            "title": "Open tasks",
            "description": "Every open task with its note and due date.",
            "mimeType": "application/json"
        }),
        json!({
            "uri": "kore://guide",
            "name": "guide",
            "title": "Agent guide",
            "description": "The vault's agent contract (AGENTS.md) and a map of its folders: read before working in the vault.",
            "mimeType": "application/json"
        }),
    ]
}

/// One prompt: its MCP definition. Prompts only read, so they all survive
/// `--read-only`.
struct Prompt {
    name: &'static str,
    title: &'static str,
    description: &'static str,
    /// (name, description, required)
    arguments: &'static [(&'static str, &'static str, bool)],
}

const PROMPTS: [Prompt; 3] = [
    Prompt {
        name: "daily_review",
        title: "Daily review",
        description: "Review a day from its daily note and the open tasks: what happened, what was decided, what carries over.",
        arguments: &[("date", "YYYY-MM-DD; today when omitted", false)],
    },
    Prompt {
        name: "weekly_review",
        title: "Weekly review",
        description: "Review the last seven days from their daily notes, the other notes changed, and the open tasks.",
        arguments: &[],
    },
    Prompt {
        name: "connect_note",
        title: "Connect a note",
        description: "Find the notes one note should link to, or be linked from, that it isn't yet.",
        arguments: &[("note", "A YYYY-MM-DD date, graph-relative path, note id, title, or alias", true)],
    },
];

fn prompt_definition(prompt: &Prompt) -> Value {
    json!({
        "name": prompt.name,
        "title": prompt.title,
        "description": prompt.description,
        "arguments": prompt.arguments.iter().map(|(name, description, required)| json!({
            "name": name, "description": description, "required": required
        })).collect::<Vec<_>>()
    })
}

fn text_content(text: impl Into<String>) -> Value {
    json!({ "type": "text", "text": text.into() })
}

/// A note embedded in a prompt message, as a `resource` content block.
fn note_content(note: &Value) -> Value {
    json!({ "type": "resource", "resource": note_resource(note, None) })
}

/// A `show`/`today` JSON object as resource contents. `uri` overrides the
/// path-derived link so a read answers with the URI it was asked for.
fn note_resource(note: &Value, uri: Option<&str>) -> Value {
    let path = note["path"].as_str().unwrap_or_default();
    json!({
        "uri": uri.map(str::to_string).unwrap_or_else(|| note_uri(path)),
        "mimeType": "text/markdown",
        "text": note["content"].as_str().unwrap_or_default()
    })
}

fn user_message(content: Value) -> Value {
    json!({ "role": "user", "content": content })
}

/// `title (kore://note/…)` lines for a list of `{ path, title }` rows.
fn note_lines(rows: &[Value]) -> String {
    rows.iter()
        .filter_map(|row| {
            let path = row["path"].as_str()?;
            let title = row["title"].as_str().unwrap_or(path);
            Some(format!("- {title} ({})", note_uri(path)))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// The local calendar date of an RFC 3339 UTC `updatedAt`, so it compares
/// with the local dates the week is built from.
fn local_date(updated_at: &str, zone: &jiff::tz::TimeZone) -> Option<String> {
    let timestamp = updated_at.parse::<jiff::Timestamp>().ok()?;
    Some(timestamp.to_zoned(zone.clone()).date().to_string())
}

/// The seven dates ending today, oldest first.
fn last_seven_days(today: jiff::civil::Date) -> Vec<String> {
    let mut dates = vec![today];
    while dates.len() < 7 {
        match dates[dates.len() - 1].yesterday() {
            Ok(previous) => dates.push(previous),
            Err(_) => break,
        }
    }
    dates.iter().rev().map(ToString::to_string).collect()
}

/// Who is calling: a named agent (with its own write permission) or the
/// vault's owner, who is unnamed and may write whenever the server does.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Caller {
    /// The agent's name, signed onto what it remembers.
    pub name: Option<String>,
    /// What this caller may do with the tools that write.
    pub access: Access,
}

impl Caller {
    /// The owner: the stdio client, or the HTTP server's own secret.
    pub fn owner() -> Self {
        Self {
            name: None,
            access: Access::Write,
        }
    }
}

/// Tools that read folders outside the vault (the Library, which holds the
/// user's other agents' rules and memory). Only a server for this machine
/// offers them; the HTTP server never does, whoever calls.
const LOCAL_ONLY_TOOLS: &[&str] = &[
    "library_sources",
    "library_files",
    "library_grep",
    "library_read",
];

/// The MCP request handler, independent of the transport.
pub struct Server<R: Runner> {
    runner: R,
    read_only: bool,
    local: bool,
}

impl<R: Runner> Server<R> {
    /// `read_only` hides and refuses every tool that writes. The server
    /// starts remote-safe: see [`Server::for_this_machine`].
    pub fn new(runner: R, read_only: bool) -> Self {
        Self {
            runner,
            read_only,
            local: false,
        }
    }

    /// Also offer the tools that read outside the vault (`LOCAL_ONLY_TOOLS`).
    /// Only for the stdio transport, whose client runs on this machine.
    pub fn for_this_machine(mut self) -> Self {
        self.local = true;
        self
    }

    fn available(&self, caller: &Caller) -> Vec<Tool> {
        let writes = !self.read_only && caller.access.sees_writes();
        tools()
            .into_iter()
            .filter(|tool| tool.effect == Effect::Read || writes)
            .filter(|tool| self.local || !LOCAL_ONLY_TOOLS.contains(&tool.name))
            .collect()
    }

    /// Answer one transport payload as the owner.
    pub fn handle_payload(&self, payload: &[u8]) -> Option<Value> {
        self.handle_payload_as(payload, &Caller::owner())
    }

    /// Answer one transport payload: a JSON-RPC message or a batch. `None`
    /// when nothing needs a reply (only notifications). Both transports
    /// funnel through here.
    pub fn handle_payload_as(&self, payload: &[u8], caller: &Caller) -> Option<Value> {
        match serde_json::from_slice::<Value>(payload) {
            Ok(Value::Array(batch)) => {
                let replies: Vec<Value> = batch
                    .iter()
                    .filter_map(|message| self.handle_as(message, caller))
                    .collect();
                (!replies.is_empty()).then_some(Value::Array(replies))
            }
            Ok(message) => self.handle_as(&message, caller),
            Err(_) => Some(error_response(Value::Null, -32700, "parse error")),
        }
    }

    /// Answer one JSON-RPC message as the owner.
    pub fn handle(&self, message: &Value) -> Option<Value> {
        self.handle_as(message, &Caller::owner())
    }

    /// Answer one JSON-RPC message. Notifications (no `id`) get `None`.
    pub fn handle_as(&self, message: &Value, caller: &Caller) -> Option<Value> {
        let id = message.get("id").cloned()?;
        let method = message.get("method").and_then(Value::as_str);
        let Some(method) = method else {
            return Some(error_response(id, -32600, "invalid request"));
        };
        let params = message.get("params").cloned().unwrap_or(Value::Null);
        let result = match method {
            "initialize" => Ok(self.initialize(&params)),
            "ping" => Ok(json!({})),
            "tools/list" => Ok(json!({
                "tools": self.available(caller).iter().map(tool_definition).collect::<Vec<_>>()
            })),
            "tools/call" => self.call(&params, caller),
            "resources/list" => self.list_resources(&params),
            "resources/templates/list" => Ok(json!({ "resourceTemplates": resource_templates() })),
            "resources/read" => self.read_resource(&params),
            "prompts/list" => Ok(json!({
                "prompts": PROMPTS.iter().map(prompt_definition).collect::<Vec<_>>()
            })),
            "prompts/get" => self.get_prompt(&params),
            _ => Err((-32601, format!("method not found: {method}"))),
        };
        Some(match result {
            Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
            Err((code, message)) => error_response(id, code, &message),
        })
    }

    fn initialize(&self, params: &Value) -> Value {
        let requested = params.get("protocolVersion").and_then(Value::as_str);
        let version = requested
            .filter(|version| PROTOCOL_VERSIONS.contains(version))
            .unwrap_or(PROTOCOL_VERSIONS[0]);
        json!({
            "protocolVersion": version,
            "capabilities": {
                "tools": { "listChanged": false },
                "resources": { "subscribe": false, "listChanged": false },
                "prompts": { "listChanged": false }
            },
            "serverInfo": { "name": "kore", "title": "Kore", "version": env!("CARGO_PKG_VERSION") },
            "instructions": self.instructions()
        })
    }

    /// The fixed instructions plus the vault's own contract, so a client
    /// that injects server instructions starts every session already under
    /// the vault's rules — the same text an agent reading the git repo finds
    /// in AGENTS.md.
    fn instructions(&self) -> String {
        let Some(contract) = self
            .run_json(&["guide".to_string()])
            .ok()
            .and_then(|guide| guide.get("contract").cloned())
            .filter(|contract| contract.is_object())
        else {
            return INSTRUCTIONS.to_string();
        };
        let path = contract["path"].as_str().unwrap_or("AGENTS.md");
        let text = contract["text"].as_str().unwrap_or_default();
        let mut instructions = format!(
            "{INSTRUCTIONS}\n\nThis vault has its own agent contract, {path}: the user's standing rules for every agent working in it. Follow it over these defaults wherever they differ.\n\n"
        );
        if text.chars().count() > INSTRUCTIONS_CONTRACT_MAX_CHARS
            || contract["truncated"].as_bool() == Some(true)
        {
            instructions.extend(text.chars().take(INSTRUCTIONS_CONTRACT_MAX_CHARS));
            instructions.push_str(&format!(
                "\n\n[contract cut here: call vault_guide or read {path} for the rest]"
            ));
        } else {
            instructions.push_str(text);
        }
        instructions
    }

    fn call(&self, params: &Value, caller: &Caller) -> Result<Value, (i64, String)> {
        let name = params
            .get("name")
            .and_then(Value::as_str)
            .ok_or((-32602, "missing tool name".to_string()))?;
        let empty = Map::new();
        let args = match params.get("arguments") {
            None | Some(Value::Null) => &empty,
            Some(Value::Object(args)) => args,
            Some(_) => return Err((-32602, "arguments must be an object".to_string())),
        };
        let tool = self
            .available(caller)
            .into_iter()
            .find(|tool| tool.name == name)
            .ok_or((-32602, format!("unknown tool: {name}")))?;
        let invocation = match invocation_for(&tool, args, caller.name.as_deref()) {
            Ok(invocation) => invocation,
            Err(message) => return Ok(tool_text(message, true)),
        };
        let agent = AgentIdentity::for_caller(caller.name.as_deref());
        if caller.access == Access::Propose && tool.effect != Effect::Read {
            return Ok(self.propose(&agent, &tool, args));
        }
        let output = self
            .runner
            .run_as(&invocation.args, invocation.stdin.as_deref(), &agent);
        Ok(tool_text(output.text, !output.success))
    }

    /// Run a subcommand and parse its `--json` output; a failure carries the
    /// CLI's own message.
    fn run_json(&self, args: &[String]) -> Result<Value, String> {
        let output = self.runner.run(args, None);
        if !output.success {
            return Err(output.text);
        }
        serde_json::from_str(&output.text)
            .map_err(|err| format!("unexpected output from kore {}: {err}", args[0]))
    }

    fn list_resources(&self, params: &Value) -> Result<Value, (i64, String)> {
        let offset = match params.get("cursor") {
            None | Some(Value::Null) => 0,
            Some(cursor) => cursor
                .as_str()
                .and_then(|cursor| cursor.parse::<usize>().ok())
                .ok_or((-32602, "invalid cursor".to_string()))?,
        };
        // One extra row tells whether another page follows.
        let limit = offset + RESOURCE_PAGE + 1;
        // Without an index (the app never opened this graph) there is no note
        // list; the fixed resources and the templates still work, so a client
        // connecting gets those rather than an error.
        let notes = self
            .run_json(&["list".to_string(), format!("--limit={limit}")])
            .ok()
            .and_then(|listed| listed["notes"].as_array().cloned())
            .unwrap_or_default();
        let mut resources = if offset == 0 {
            fixed_resources()
        } else {
            Vec::new()
        };
        resources.extend(
            notes
                .iter()
                .skip(offset)
                .take(RESOURCE_PAGE)
                .filter_map(|note| {
                    let path = note["path"].as_str()?;
                    Some(json!({
                        "uri": note_uri(path),
                        "name": path,
                        "title": note["title"].as_str().unwrap_or(path),
                        "mimeType": "text/markdown"
                    }))
                }),
        );
        let mut result = json!({ "resources": resources });
        if notes.len() > offset + RESOURCE_PAGE {
            result["nextCursor"] = json!((offset + RESOURCE_PAGE).to_string());
        }
        Ok(result)
    }

    fn read_resource(&self, params: &Value) -> Result<Value, (i64, String)> {
        let uri = params
            .get("uri")
            .and_then(Value::as_str)
            .ok_or((-32602, "missing resource uri".to_string()))?;
        let target =
            resource_target(uri).ok_or((RESOURCE_NOT_FOUND, format!("unknown resource: {uri}")))?;
        let contents = match target {
            ResourceTarget::Note(args) => {
                let note = self
                    .run_json(&args)
                    .map_err(|message| (RESOURCE_NOT_FOUND, message))?;
                note_resource(&note, Some(uri))
            }
            ResourceTarget::Tasks | ResourceTarget::Guide => {
                let command = if matches!(target, ResourceTarget::Tasks) {
                    "tasks"
                } else {
                    "guide"
                };
                let output = self.runner.run(&[command.to_string()], None);
                if !output.success {
                    return Err((RESOURCE_NOT_FOUND, output.text));
                }
                json!({ "uri": uri, "mimeType": "application/json", "text": output.text })
            }
        };
        Ok(json!({ "contents": [contents] }))
    }

    fn get_prompt(&self, params: &Value) -> Result<Value, (i64, String)> {
        let name = params
            .get("name")
            .and_then(Value::as_str)
            .ok_or((-32602, "missing prompt name".to_string()))?;
        let argument = |key: &str| {
            params
                .get("arguments")
                .and_then(|args| args.get(key))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        };
        let prompt = PROMPTS
            .iter()
            .find(|prompt| prompt.name == name)
            .ok_or((-32602, format!("unknown prompt: {name}")))?;
        let messages = match prompt.name {
            "daily_review" => self.daily_review(argument("date")),
            "weekly_review" => self.weekly_review(),
            _ => {
                let note = argument("note").ok_or((-32602, "`note` is required".to_string()))?;
                self.connect_note(note)?
            }
        };
        Ok(json!({ "description": prompt.description, "messages": messages }))
    }

    /// The open tasks as an embedded resource, or nothing when there is no
    /// index to read them from.
    fn open_tasks(&self) -> Option<Value> {
        let output = self.runner.run(&["tasks".to_string()], None);
        output.success.then(|| {
            user_message(json!({ "type": "resource", "resource": {
                "uri": "kore://tasks", "mimeType": "application/json", "text": output.text
            } }))
        })
    }

    fn daily_review(&self, date: Option<String>) -> Vec<Value> {
        let args = match &date {
            Some(date) => vec!["show".to_string(), "--".to_string(), date.clone()],
            None => vec!["today".to_string()],
        };
        let label = date.clone().unwrap_or_else(|| "today".to_string());
        let mut messages = Vec::new();
        match self.run_json(&args) {
            Ok(note) => messages.push(user_message(note_content(&note))),
            Err(message) => messages.push(user_message(text_content(format!(
                "There is no daily note to review for {label} ({message})."
            )))),
        }
        messages.extend(self.open_tasks());
        messages.push(user_message(text_content(format!(
            "This is my Kore daily note for {label} and my open tasks. Review the day: what \
             happened, what I decided, and what is still open. Then list what should carry over \
             to tomorrow, each with the note it comes from. Read linked notes or backlinks with \
             the Kore tools when the daily note alone is not enough."
        ))));
        messages
    }

    fn weekly_review(&self) -> Vec<Value> {
        let dates = last_seven_days(jiff::Zoned::now().date());
        let (start, end) = (dates[0].clone(), dates[dates.len() - 1].clone());
        let mut messages: Vec<Value> = dates
            .iter()
            .filter_map(|date| {
                self.run_json(&["show".to_string(), "--".to_string(), date.clone()])
                    .ok()
            })
            .map(|note| user_message(note_content(&note)))
            .collect();
        // `list` is newest first, so the week's changes are a prefix: read one
        // more row than shown to know whether the cap cut the list short.
        let listed: Vec<Value> = self
            .run_json(&[
                "list".to_string(),
                "--kind=note".to_string(),
                format!("--limit={}", WEEKLY_CHANGED_CAP + 1),
            ])
            .ok()
            .and_then(|listed| listed["notes"].as_array().cloned())
            .unwrap_or_default();
        let zone = jiff::tz::TimeZone::system();
        let in_week: Vec<Value> = listed
            .into_iter()
            .take_while(|note| {
                note["updatedAt"]
                    .as_str()
                    .and_then(|at| local_date(at, &zone))
                    .is_some_and(|date| date >= start)
            })
            .collect();
        if !in_week.is_empty() {
            let shown = &in_week[..in_week.len().min(WEEKLY_CHANGED_CAP)];
            let more = if in_week.len() > WEEKLY_CHANGED_CAP {
                format!(
                    "\n(These are the {WEEKLY_CHANGED_CAP} most recent; more changed this week. \
                     recent_notes or list_notes reach the rest.)"
                )
            } else {
                String::new()
            };
            messages.push(user_message(text_content(format!(
                "Other notes I changed this week:\n{}{more}",
                note_lines(shown)
            ))));
        }
        messages.extend(self.open_tasks());
        messages.push(user_message(text_content(format!(
            "This is my week in Kore, {start} to {end}: the daily notes that exist, the other \
             notes I changed, and my open tasks. Write my weekly review: the main threads and \
             decisions, what moved and what stalled, and the open loops worth closing next week. \
             Read a changed note with read_note when its title is not enough, and cite notes by \
             title."
        ))));
        messages
    }

    fn connect_note(&self, note: String) -> Result<Vec<Value>, (i64, String)> {
        let shown = self
            .run_json(&["show".to_string(), "--".to_string(), note])
            .map_err(|message| (-32602, message))?;
        let path = shown["path"].as_str().unwrap_or_default().to_string();
        let title = shown["title"].as_str().unwrap_or(&path).to_string();
        let rows = |subcommand: &str, key: &str| {
            self.run_json(&[subcommand.to_string(), "--".to_string(), path.clone()])
                .ok()
                .and_then(|value| value[key].as_array().cloned())
                .unwrap_or_default()
        };
        let links: Vec<Value> = rows("links", "links")
            .into_iter()
            .filter(|link| link["path"].is_string())
            .collect();
        let backlinks = rows("backlinks", "backlinks");
        let listed = |rows: &[Value]| {
            if rows.is_empty() {
                "(none)".to_string()
            } else {
                note_lines(rows)
            }
        };
        Ok(vec![
            user_message(note_content(&shown)),
            user_message(text_content(format!(
                "It links to:\n{}\n\nIt is linked from:\n{}",
                listed(&links),
                listed(&backlinks)
            ))),
            user_message(text_content(format!(
                "Help me connect \"{title}\" into my Kore notes. Summarize it in two lines. Then \
                 search my notes for its main ideas, people and projects, and list the notes it \
                 should link to, or that should link to it, which are not linked yet: one line \
                 each, with why. Propose the links; do not edit any note unless I ask."
            ))),
        ])
    }
}

fn error_response(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

/// Serve newline-delimited JSON-RPC until `input` closes.
pub fn serve<R: Runner>(
    server: &Server<R>,
    input: impl BufRead,
    mut output: impl Write,
) -> io::Result<()> {
    for line in input.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        if let Some(response) = server.handle_payload(line.as_bytes()) {
            writeln!(output, "{response}")?;
            output.flush()?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use super::*;

    #[derive(Default)]
    struct Recorder {
        calls: RefCell<Vec<(Vec<String>, Option<String>)>>,
    }

    impl Runner for &Recorder {
        fn run(&self, args: &[String], stdin: Option<&str>) -> RunOutput {
            self.calls
                .borrow_mut()
                .push((args.to_vec(), stdin.map(str::to_string)));
            RunOutput {
                success: args[0] != "today",
                text: if args[0] == "today" {
                    "no daily note for 2026-10-17 yet".to_string()
                } else {
                    "{}".to_string()
                },
            }
        }
    }

    fn call(server: &Server<&Recorder>, name: &str, arguments: Value) -> Value {
        server
            .handle(&json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call",
                "params": { "name": name, "arguments": arguments } }))
            .unwrap()
    }

    #[test]
    fn maps_tool_arguments_to_argv_with_positionals_after_the_separator() {
        let recorder = Recorder::default();
        let server = Server::new(&recorder, false);
        call(
            &server,
            "search",
            json!({ "query": "-draft plans", "limit": 5 }),
        );
        call(
            &server,
            "create_note",
            json!({ "title": "Acme", "body": "line 1\nline 2", "tags": ["company"],
                    "properties": { "stage": "lead", "topics": ["a", "b"] } }),
        );
        let calls = recorder.calls.borrow();
        assert_eq!(calls[0].0, ["search", "--limit=5", "--", "-draft plans"]);
        assert_eq!(
            calls[1].0,
            [
                "new",
                "--tag=company",
                "--set=stage=lead",
                "--set=topics=a, b",
                "--stdin",
                "--",
                "Acme"
            ]
        );
        assert_eq!(calls[1].1.as_deref(), Some("line 1\nline 2"));
    }

    #[test]
    fn search_mode_and_edit_note_reach_argv_as_single_entries() {
        let recorder = Recorder::default();
        let server = Server::new(&recorder, false);
        call(
            &server,
            "search",
            json!({ "query": "what do I know about pricing", "mode": "semantic" }),
        );
        call(
            &server,
            "edit_note",
            json!({ "note": "Plan", "oldText": "-- ship\nin May", "newText": "ship in June" }),
        );
        call(
            &server,
            "edit_note",
            json!({ "note": "Log", "oldText": "", "newText": "- two" }),
        );
        let bad_mode = call(&server, "search", json!({ "query": "x", "mode": "fuzzy" }));
        let no_old = call(
            &server,
            "edit_note",
            json!({ "note": "Plan", "newText": "y" }),
        );
        let calls = recorder.calls.borrow();
        assert_eq!(
            calls[0].0,
            [
                "search",
                "--mode=semantic",
                "--",
                "what do I know about pricing"
            ]
        );
        assert_eq!(
            calls[1].0,
            [
                "edit",
                "--old=-- ship\nin May",
                "--new=ship in June",
                "--",
                "Plan"
            ]
        );
        assert_eq!(calls[2].0, ["edit", "--old=", "--new=- two", "--", "Log"]);
        assert_eq!(calls.len(), 3, "invalid arguments never run");
        assert_eq!(bad_mode["result"]["isError"], true);
        assert_eq!(no_old["result"]["isError"], true);
    }

    #[test]
    fn only_edit_note_is_annotated_destructive() {
        let recorder = Recorder::default();
        let server = Server::new(&recorder, false);
        let list = server
            .handle(&json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }))
            .unwrap();
        let tools = list["result"]["tools"].as_array().unwrap();
        let destructive: Vec<&str> = tools
            .iter()
            .filter(|tool| tool["annotations"]["destructiveHint"] == true)
            .map(|tool| tool["name"].as_str().unwrap())
            .collect();
        assert_eq!(destructive, ["edit_note"]);
        let edit = tools
            .iter()
            .find(|tool| tool["name"] == "edit_note")
            .unwrap();
        assert_eq!(edit["annotations"]["readOnlyHint"], false);
    }

    fn tool_names(server: &Server<&Recorder>) -> Vec<String> {
        let list = server
            .handle(&json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }))
            .unwrap();
        list["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|tool| tool["name"].as_str().unwrap().to_string())
            .collect()
    }

    #[test]
    fn the_library_is_offered_only_on_this_machine() {
        let recorder = Recorder::default();
        let remote = Server::new(&recorder, false);
        let names = tool_names(&remote);
        for tool in LOCAL_ONLY_TOOLS {
            assert!(!names.iter().any(|name| name == tool), "{tool} leaked");
        }
        let refused = call(
            &remote,
            "library_read",
            json!({ "path": "claude/CLAUDE.md" }),
        );
        assert_eq!(refused["error"]["code"], -32602);
        assert!(recorder.calls.borrow().is_empty());

        let local = Server::new(&recorder, false).for_this_machine();
        let names = tool_names(&local);
        for tool in LOCAL_ONLY_TOOLS {
            assert!(names.iter().any(|name| name == tool), "{tool} missing");
        }
        call(
            &local,
            "library_grep",
            json!({ "text": "-rule", "source": "claude", "ignore_case": true, "limit": 3 }),
        );
        call(
            &local,
            "library_read",
            json!({ "path": "claude/CLAUDE.md" }),
        );
        let calls = recorder.calls.borrow();
        assert_eq!(
            calls[0].0,
            [
                "library",
                "grep",
                "--ignore-case",
                "--source=claude",
                "--limit=3",
                "--",
                "-rule"
            ]
        );
        assert_eq!(calls[1].0, ["library", "read", "--", "claude/CLAUDE.md"]);
    }

    #[test]
    fn edit_note_is_a_write_hidden_under_read_only() {
        let recorder = Recorder::default();
        let server = Server::new(&recorder, true);
        let refused = call(
            &server,
            "edit_note",
            json!({ "note": "Plan", "oldText": "a", "newText": "b" }),
        );
        assert_eq!(refused["error"]["code"], -32602);
        assert!(recorder.calls.borrow().is_empty());
    }

    #[test]
    fn a_failing_command_is_a_tool_error_not_a_protocol_error() {
        let recorder = Recorder::default();
        let server = Server::new(&recorder, false);
        let reply = call(&server, "today", json!({}));
        assert_eq!(reply["result"]["isError"], true);
        assert_eq!(
            reply["result"]["content"][0]["text"],
            "no daily note for 2026-10-17 yet"
        );
        let missing = call(&server, "read_note", json!({}));
        assert_eq!(missing["result"]["isError"], true);
        assert!(recorder.calls.borrow().len() == 1, "invalid args never run");
    }

    #[test]
    fn read_only_hides_and_refuses_writes() {
        let recorder = Recorder::default();
        let server = Server::new(&recorder, true);
        let list = server
            .handle(&json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }))
            .unwrap();
        let names: Vec<&str> = list["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|tool| tool["name"].as_str().unwrap())
            .collect();
        assert!(names.contains(&"search"));
        assert!(!names.contains(&"capture"));
        let refused = call(&server, "capture", json!({ "text": "x" }));
        assert_eq!(refused["error"]["code"], -32602);
        assert!(recorder.calls.borrow().is_empty());
    }

    #[test]
    fn a_propose_key_sees_the_write_tools_but_its_writes_become_proposals() {
        let recorder = Recorder::default();
        let server = Server::new(&recorder, false);
        let grok = Caller {
            name: Some("Grok".into()),
            access: Access::Propose,
        };
        let list = server
            .handle_as(
                &json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }),
                &grok,
            )
            .unwrap();
        assert!(list["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .any(|tool| tool["name"] == "capture"));

        let reply = server
            .handle_as(
                &json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/call",
                    "params": { "name": "capture", "arguments": { "text": "buy milk" } } }),
                &grok,
            )
            .unwrap();
        let text = reply["result"]["content"][0]["text"].as_str().unwrap();
        assert!(text.starts_with("Not written yet"), "{text}");
        let calls = recorder.calls.borrow();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, ["proposals", "add"]);
        // Only the call travels: `proposals add` signs it from its own process.
        let call: propose::ProposedCall =
            serde_json::from_str(calls[0].1.as_deref().unwrap()).unwrap();
        assert_eq!(call.tool, "capture");
        assert_eq!(call.arguments["text"], "buy milk");
        drop(calls);

        // Arguments that would not build are refused now, not kept.
        let reply = server
            .handle_as(
                &json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/call",
                    "params": { "name": "capture", "arguments": {} } }),
                &grok,
            )
            .unwrap();
        assert_eq!(reply["result"]["isError"], true);
        assert_eq!(recorder.calls.borrow().len(), 1);
    }

    #[test]
    fn a_read_only_server_gives_a_propose_key_no_writes_to_propose() {
        let recorder = Recorder::default();
        let server = Server::new(&recorder, true);
        let grok = Caller {
            name: Some("Grok".into()),
            access: Access::Propose,
        };
        let list = server
            .handle_as(
                &json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }),
                &grok,
            )
            .unwrap();
        assert!(!list["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .any(|tool| tool["name"] == "capture"));
        let reply = server
            .handle_as(
                &json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/call",
                    "params": { "name": "capture", "arguments": { "text": "x" } } }),
                &grok,
            )
            .unwrap();
        assert!(reply["error"]["message"]
            .as_str()
            .unwrap()
            .contains("unknown tool"));
        assert!(recorder.calls.borrow().is_empty());
    }

    #[test]
    fn an_accepted_call_is_rebuilt_and_checked_like_a_direct_one() {
        let call = |tool: &str, arguments: Value| propose::ProposedCall {
            tool: tool.to_string(),
            arguments: arguments.as_object().unwrap().clone(),
        };
        let (args, _) =
            propose::invocation(&call("capture", json!({ "text": "hi" })), "Grok").unwrap();
        assert_eq!(args[0], "capture");
        // A read tool, or a made-up one, is never run from a proposal.
        assert!(propose::invocation(&call("search", json!({ "query": "x" })), "Grok").is_err());
        assert!(propose::invocation(&call("rm", json!({})), "Grok").is_err());
        assert!(propose::invocation(&call("capture", json!({})), "Grok").is_err());
        // `remember` is signed by the proposing agent, whatever it claimed.
        let (signed, _) = propose::invocation(
            &call("remember", json!({ "fact": "f", "agent": "Owner" })),
            "Grok",
        )
        .unwrap();
        let line = signed.last().unwrap();
        assert!(line.contains("Grok") && !line.contains("Owner"), "{line}");
    }

    #[test]
    fn remember_signs_the_fact_with_the_callers_own_name() {
        let recorder = Recorder::default();
        let server = Server::new(&recorder, false);
        let grok = Caller {
            name: Some("Grok bot".into()),
            access: Access::Write,
        };
        server.handle_as(
            &json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {
                "name": "remember",
                "arguments": { "fact": "Mario lives in\nRome", "previously": "Milan",
                               "agent": "someone else", "note": "People/Mario" } } }),
            &grok,
        );
        let calls = recorder.calls.borrow();
        let line = calls[0].0.last().unwrap();
        assert_eq!(calls[0].0[..3], ["capture", "--to=People/Mario", "--"]);
        assert!(line.starts_with("[likely] Mario lives in Rome (previously: Milan) — Grok bot, "));

        let reader = Caller {
            name: Some("ChatGPT".into()),
            access: Access::Read,
        };
        let refused = server
            .handle_as(
                &json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/call",
                    "params": { "name": "remember", "arguments": { "fact": "x" } } }),
                &reader,
            )
            .unwrap();
        assert!(refused["error"]["message"]
            .as_str()
            .unwrap()
            .contains("unknown tool"));
        assert_eq!(
            remembered_line("x", Some("sure"), None, None, "2026-11-04").unwrap_err(),
            "`confidence` must be one of certain, likely, speculative"
        );
    }

    #[test]
    fn negotiates_the_protocol_and_ignores_notifications() {
        let recorder = Recorder::default();
        let server = Server::new(&recorder, false);
        let init = server
            .handle(&json!({ "jsonrpc": "2.0", "id": 0, "method": "initialize",
                "params": { "protocolVersion": "2024-11-05" } }))
            .unwrap();
        assert_eq!(init["result"]["protocolVersion"], "2024-11-05");
        let future = server
            .handle(&json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": { "protocolVersion": "2099-01-01" } }))
            .unwrap();
        assert_eq!(future["result"]["protocolVersion"], PROTOCOL_VERSIONS[0]);
        assert!(server
            .handle(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }))
            .is_none());
        assert!(init["result"]["capabilities"]["resources"].is_object());
        assert!(init["result"]["capabilities"]["prompts"].is_object());
        let unknown = server
            .handle(&json!({ "jsonrpc": "2.0", "id": 2, "method": "completion/complete" }))
            .unwrap();
        assert_eq!(unknown["error"]["code"], -32601);
    }

    /// Answers each subcommand from a canned table; anything missing fails
    /// the way a missing note does.
    struct Canned {
        outputs: Vec<(&'static str, Value)>,
        calls: RefCell<Vec<Vec<String>>>,
    }

    impl Canned {
        fn new(outputs: Vec<(&'static str, Value)>) -> Self {
            Self {
                outputs,
                calls: RefCell::default(),
            }
        }
    }

    impl Runner for &Canned {
        fn run(&self, args: &[String], _stdin: Option<&str>) -> RunOutput {
            self.calls.borrow_mut().push(args.to_vec());
            match self.outputs.iter().find(|(name, _)| *name == args[0]) {
                Some((_, output)) => RunOutput {
                    success: true,
                    text: output.to_string(),
                },
                None => RunOutput {
                    success: false,
                    text: format!("no note matching '{}'", args[args.len() - 1]),
                },
            }
        }
    }

    fn request(server: &Server<&Canned>, method: &str, params: Value) -> Value {
        server
            .handle(&json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params }))
            .unwrap()
    }

    #[test]
    fn resource_uris_are_the_apps_deep_links() {
        assert_eq!(
            note_uri("Projects/Q3 plan (draft).md"),
            "kore://note/Projects%2FQ3%20plan%20(draft).md"
        );
        assert_eq!(
            note_uri("notes/caffè.md"),
            "kore://note/notes%2Fcaff%C3%A8.md"
        );
        let decoded = decode_component("Projects%2FQ3%20plan%20(draft).md").unwrap();
        assert_eq!(decoded, "Projects/Q3 plan (draft).md");

        let argv = |uri: &str| match resource_target(uri) {
            Some(ResourceTarget::Note(args)) => Some(args),
            _ => None,
        };
        assert_eq!(
            argv("kore://note/notes%2Fcaff%C3%A8.md").unwrap(),
            ["show", "--", "notes/caffè.md"]
        );
        assert_eq!(
            argv("kore://note/01hzy3v9k2m4n6p8q0r2s4t6vw").unwrap(),
            ["show", "--", "01hzy3v9k2m4n6p8q0r2s4t6vw"]
        );
        assert_eq!(
            argv("kore://daily/2026-10-17").unwrap(),
            ["show", "--", "2026-10-17"]
        );
        assert_eq!(argv("kore://today").unwrap(), ["today"]);
        assert!(matches!(
            resource_target("kore://tasks"),
            Some(ResourceTarget::Tasks)
        ));
        assert!(matches!(
            resource_target("kore://guide"),
            Some(ResourceTarget::Guide)
        ));
        assert!(resource_target("kore://note/").is_none());
        assert!(
            resource_target("kore://note/%E2%28").is_none(),
            "invalid UTF-8"
        );
        assert!(resource_target("kore://search?q=x").is_none());
        assert!(resource_target("file:///etc/passwd").is_none());
    }

    #[test]
    fn resources_list_pages_through_every_note_newest_first() {
        let notes: Vec<Value> = (0..RESOURCE_PAGE + 2)
            .map(|index| json!({ "path": format!("notes/{index}.md"), "title": format!("N{index}") }))
            .collect();
        let canned = Canned::new(vec![("list", json!({ "stale": false, "notes": notes }))]);
        let server = Server::new(&canned, true);

        let first = request(&server, "resources/list", json!({}));
        let resources = first["result"]["resources"].as_array().unwrap();
        assert_eq!(
            resources.len(),
            3 + RESOURCE_PAGE,
            "today, tasks and the guide lead page one"
        );
        assert_eq!(resources[0]["uri"], "kore://today");
        assert_eq!(resources[3]["uri"], "kore://note/notes%2F0.md");
        assert_eq!(resources[3]["title"], "N0");
        assert_eq!(first["result"]["nextCursor"], RESOURCE_PAGE.to_string());

        let second = request(
            &server,
            "resources/list",
            json!({ "cursor": first["result"]["nextCursor"] }),
        );
        let resources = second["result"]["resources"].as_array().unwrap();
        assert_eq!(resources.len(), 2);
        assert_eq!(
            resources[1]["name"],
            format!("notes/{}.md", RESOURCE_PAGE + 1)
        );
        assert!(second["result"].get("nextCursor").is_none());

        let bad = request(&server, "resources/list", json!({ "cursor": "x" }));
        assert_eq!(bad["error"]["code"], -32602);
    }

    #[test]
    fn instructions_carry_the_vaults_own_contract() {
        let without = Canned::new(vec![("guide", json!({ "contract": null, "map": {} }))]);
        let init = request(&Server::new(&without, true), "initialize", json!({}));
        assert_eq!(init["result"]["instructions"], INSTRUCTIONS);

        let with = Canned::new(vec![(
            "guide",
            json!({ "contract": { "path": "AGENTS.md", "text": "Decisions go in _system/memory/decisions/.", "truncated": false }, "map": {} }),
        )]);
        let init = request(&Server::new(&with, true), "initialize", json!({}));
        let instructions = init["result"]["instructions"].as_str().unwrap();
        assert!(instructions.starts_with(INSTRUCTIONS));
        assert!(instructions.contains("own agent contract, AGENTS.md"));
        assert!(instructions.ends_with("Decisions go in _system/memory/decisions/."));
    }

    #[test]
    fn resources_read_answers_with_the_uri_it_was_asked_for() {
        let canned = Canned::new(vec![(
            "show",
            json!({ "date": null, "path": "notes/a.md", "title": "A", "content": "# A\nbody\n" }),
        )]);
        let server = Server::new(&canned, false);
        let uri = "kore://note/01hzy3v9k2m4n6p8q0r2s4t6vw";
        let read = request(&server, "resources/read", json!({ "uri": uri }));
        let contents = &read["result"]["contents"][0];
        assert_eq!(contents["uri"], uri);
        assert_eq!(contents["mimeType"], "text/markdown");
        assert_eq!(contents["text"], "# A\nbody\n");

        let missing = request(&server, "resources/read", json!({ "uri": "kore://today" }));
        assert_eq!(missing["error"]["code"], RESOURCE_NOT_FOUND);
        let unknown = request(
            &server,
            "resources/read",
            json!({ "uri": "https://example.com" }),
        );
        assert_eq!(unknown["error"]["code"], RESOURCE_NOT_FOUND);
    }

    #[test]
    fn prompts_survive_read_only_and_embed_the_notes_they_review() {
        let canned = Canned::new(vec![
            (
                "show",
                json!({ "date": null, "path": "notes/acme.md", "title": "Acme", "content": "# Acme\n" }),
            ),
            (
                "links",
                json!({ "path": "notes/acme.md", "stale": false, "links": [
                    { "target": "Bob", "path": "people/bob.md", "title": "Bob" },
                    { "target": "Ghost", "path": null, "title": null }
                ] }),
            ),
            (
                "backlinks",
                json!({ "path": "notes/acme.md", "title": "Acme", "stale": false, "backlinks": [] }),
            ),
        ]);
        let server = Server::new(&canned, true);
        let listed = request(&server, "prompts/list", json!({}));
        let names: Vec<&str> = listed["result"]["prompts"]
            .as_array()
            .unwrap()
            .iter()
            .map(|prompt| prompt["name"].as_str().unwrap())
            .collect();
        assert_eq!(names, ["daily_review", "weekly_review", "connect_note"]);

        let prompt = request(
            &server,
            "prompts/get",
            json!({ "name": "connect_note", "arguments": { "note": "Acme" } }),
        );
        let messages = prompt["result"]["messages"].as_array().unwrap();
        assert_eq!(messages[0]["content"]["type"], "resource");
        assert_eq!(
            messages[0]["content"]["resource"]["uri"],
            "kore://note/notes%2Facme.md"
        );
        let neighbours = messages[1]["content"]["text"].as_str().unwrap();
        assert!(neighbours.contains("- Bob (kore://note/people%2Fbob.md)"));
        assert!(
            !neighbours.contains("Ghost"),
            "unresolved links are not notes"
        );
        assert!(neighbours.contains("linked from:\n(none)"));
        assert_eq!(
            canned.calls.borrow()[1],
            ["links", "--", "notes/acme.md"],
            "neighbours are read by the resolved path"
        );

        let no_note = request(
            &server,
            "prompts/get",
            json!({ "name": "connect_note", "arguments": {} }),
        );
        assert_eq!(no_note["error"]["code"], -32602);
        let unknown = request(&server, "prompts/get", json!({ "name": "nope" }));
        assert_eq!(unknown["error"]["code"], -32602);
    }

    #[test]
    fn a_review_without_its_daily_note_still_has_something_to_say() {
        let canned = Canned::new(vec![("tasks", json!({ "stale": false, "tasks": [] }))]);
        let server = Server::new(&canned, false);
        let prompt = request(
            &server,
            "prompts/get",
            json!({ "name": "daily_review", "arguments": { "date": "2026-10-16" } }),
        );
        let messages = prompt["result"]["messages"].as_array().unwrap();
        assert!(messages[0]["content"]["text"]
            .as_str()
            .unwrap()
            .starts_with("There is no daily note to review for 2026-10-16"));
        assert_eq!(messages[1]["content"]["resource"]["uri"], "kore://tasks");
        assert_eq!(messages.len(), 3);

        let weekly = request(&server, "prompts/get", json!({ "name": "weekly_review" }));
        assert!(weekly["result"]["messages"].as_array().unwrap().len() >= 2);
    }

    #[test]
    fn the_weekly_review_says_when_the_changed_list_is_cut_short() {
        let now = jiff::Timestamp::now().to_string();
        let notes: Vec<Value> = (0..=WEEKLY_CHANGED_CAP)
            .map(|index| {
                json!({ "path": format!("notes/{index}.md"), "title": format!("N{index}"),
                                  "kind": "note", "updatedAt": now })
            })
            .chain([
                json!({ "path": "notes/old.md", "title": "Old", "kind": "note",
                            "updatedAt": "2020-01-01T00:00:00Z" }),
            ])
            .collect();
        let canned = Canned::new(vec![("list", json!({ "stale": false, "notes": notes }))]);
        let server = Server::new(&canned, true);
        let weekly = request(&server, "prompts/get", json!({ "name": "weekly_review" }));
        let changed = weekly["result"]["messages"][0]["content"]["text"]
            .as_str()
            .unwrap();
        assert_eq!(changed.matches("\n- N").count(), WEEKLY_CHANGED_CAP);
        assert!(changed.contains("more changed this week"));
        assert!(!changed.contains("Old"));
    }

    #[test]
    fn a_change_counts_on_its_local_day() {
        let rome = jiff::tz::TimeZone::get("Europe/Rome").unwrap();
        assert_eq!(
            local_date("2026-10-11T22:30:00Z", &rome).as_deref(),
            Some("2026-10-12"),
            "half past midnight in Rome is still the 11th in UTC"
        );
        assert_eq!(local_date("not a time", &rome), None);
    }

    #[test]
    fn the_week_ends_today() {
        let dates = last_seven_days("2026-03-02".parse().unwrap());
        assert_eq!(dates.first().unwrap(), "2026-02-24");
        assert_eq!(dates.last().unwrap(), "2026-03-02");
        assert_eq!(dates.len(), 7);
    }
}
