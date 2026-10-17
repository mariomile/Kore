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
//! Transport: newline-delimited JSON-RPC 2.0 on stdin/stdout (the MCP stdio
//! transport). stdout carries protocol messages only; nothing else is printed.

use std::io::{self, BufRead, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};

use serde_json::{json, Map, Value};

/// Protocol revisions this server speaks, newest first. A client asking for
/// one of these gets it back; anything else gets the newest.
const PROTOCOL_VERSIONS: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS: &str = "Tools over the user's Kore notes: a local folder of \
Markdown files with [[wiki links]], #tags, frontmatter properties, tasks, and one \
daily note per day. A <note> argument accepts a YYYY-MM-DD date, a graph-relative \
path, a title, or an alias. Search first, then read_note what you need. Notes the \
user marked private are never returned. Writes are structural: they append, create, \
or set one property; nothing overwrites a note's prose.";

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
}

/// Spawns this binary against one graph.
pub struct ProcessRunner {
    pub exe: PathBuf,
    pub graph: PathBuf,
}

impl Runner for ProcessRunner {
    fn run(&self, args: &[String], stdin: Option<&str>) -> RunOutput {
        let mut command = Command::new(&self.exe);
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

/// One tool: its MCP definition and how its arguments become argv.
struct Tool {
    name: &'static str,
    description: &'static str,
    read_only: bool,
    /// JSON Schema `properties` and `required` for the input.
    properties: fn() -> Value,
    required: &'static [&'static str],
    build: fn(&Map<String, Value>) -> Result<Invocation, String>,
}

/// argv (from the subcommand on) plus optional stdin.
struct Invocation {
    args: Vec<String>,
    stdin: Option<String>,
}

impl Invocation {
    fn new(subcommand: &str) -> Self {
        Self {
            args: vec![subcommand.to_string()],
            stdin: None,
        }
    }

    fn flag(mut self, name: &str, on: bool) -> Self {
        if on {
            self.args.push(format!("--{name}"));
        }
        self
    }

    fn option(mut self, name: &str, value: Option<String>) -> Self {
        // `--name=value` in one entry: clap would read a separate value
        // that starts with `-` as another flag.
        if let Some(value) = value {
            self.args.push(format!("--{name}={value}"));
        }
        self
    }

    /// Positionals go after `--` so a value beginning with `-` is never read
    /// as a flag.
    fn positionals(mut self, values: &[String]) -> Self {
        self.args.push("--".to_string());
        self.args.extend(values.iter().cloned());
        self
    }
}

fn string_arg(args: &Map<String, Value>, key: &str) -> Result<Option<String>, String> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(text)) => Ok(Some(text.clone())),
        Some(_) => Err(format!("`{key}` must be a string")),
    }
}

fn required_string(args: &Map<String, Value>, key: &str) -> Result<String, String> {
    match string_arg(args, key)? {
        Some(text) if !text.trim().is_empty() => Ok(text),
        _ => Err(format!("`{key}` is required")),
    }
}

fn bool_arg(args: &Map<String, Value>, key: &str) -> Result<bool, String> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(false),
        Some(Value::Bool(on)) => Ok(*on),
        Some(_) => Err(format!("`{key}` must be a boolean")),
    }
}

fn limit_arg(args: &Map<String, Value>) -> Result<Option<String>, String> {
    match args.get("limit") {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(number)) => match number.as_u64() {
            Some(limit) if limit > 0 => Ok(Some(limit.to_string())),
            _ => Err("`limit` must be a positive integer".to_string()),
        },
        Some(_) => Err("`limit` must be a positive integer".to_string()),
    }
}

fn string_list(args: &Map<String, Value>, key: &str) -> Result<Vec<String>, String> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(Vec::new()),
        Some(Value::Array(items)) => items
            .iter()
            .map(|item| match item {
                Value::String(text) => Ok(text.clone()),
                _ => Err(format!("`{key}` must be a list of strings")),
            })
            .collect(),
        Some(_) => Err(format!("`{key}` must be a list of strings")),
    }
}

/// `{"status": "active", "rating": 4, "topics": ["a", "b"]}` → `key=value`
/// pairs in the CLI's assignment syntax (lists comma-separated).
fn assignments(args: &Map<String, Value>, key: &str) -> Result<Vec<String>, String> {
    let object = match args.get(key) {
        None | Some(Value::Null) => return Ok(Vec::new()),
        Some(Value::Object(object)) => object,
        Some(_) => return Err(format!("`{key}` must be an object of property values")),
    };
    object
        .iter()
        .map(|(name, value)| {
            let text = match value {
                Value::String(text) => text.clone(),
                Value::Number(number) => number.to_string(),
                Value::Bool(on) => on.to_string(),
                Value::Array(items) => items
                    .iter()
                    .map(|item| match item {
                        Value::String(text) => Ok(text.clone()),
                        Value::Number(number) => Ok(number.to_string()),
                        _ => Err(format!("`{key}.{name}` list items must be strings")),
                    })
                    .collect::<Result<Vec<_>, _>>()?
                    .join(", "),
                _ => {
                    return Err(format!(
                        "`{key}.{name}` must be a string, number, boolean or list"
                    ))
                }
            };
            Ok(format!("{name}={text}"))
        })
        .collect()
}

fn note_schema() -> Value {
    json!({ "type": "string", "description": "A YYYY-MM-DD date, graph-relative path, note title, or alias" })
}

fn limit_schema(default: u64) -> Value {
    json!({ "type": "integer", "minimum": 1, "description": format!("Maximum results (default {default})") })
}

fn no_properties() -> Value {
    json!({})
}

fn tools() -> Vec<Tool> {
    vec![
        Tool {
            name: "search",
            description: "Full-text search over every note, ranked by relevance (title matches first). Returns paths, titles and snippets. The query takes Kore's search operators: #tag or tag:#tag (nested tags included), -#tag, \"exact phrase\", -word, path:CRM/, file:name, [key] or [key:value], is:daily, is:pinned, links:Note, linked-from:Note, updated:>YYYY-MM-DD. Filters alone list matching notes newest first.",
            read_only: true,
            properties: || json!({ "query": { "type": "string", "description": "Search terms and operators, e.g. tag:#type/person path:CRM/ roadmap" }, "limit": limit_schema(20) }),
            required: &["query"],
            build: |args| {
                let query = required_string(args, "query")?;
                Ok(Invocation::new("search").option("limit", limit_arg(args)?).positionals(&[query]))
            },
        },
        Tool {
            name: "read_note",
            description: "Read one note's full Markdown content, with its path, title and daily date.",
            read_only: true,
            properties: || json!({ "note": note_schema() }),
            required: &["note"],
            build: |args| Ok(Invocation::new("show").positionals(&[required_string(args, "note")?])),
        },
        Tool {
            name: "today",
            description: "Read today's daily note. Fails when it does not exist yet; capture creates it.",
            read_only: true,
            properties: no_properties,
            required: &[],
            build: |_| Ok(Invocation::new("today")),
        },
        Tool {
            name: "backlinks",
            description: "List the notes that link to a note.",
            read_only: true,
            properties: || json!({ "note": note_schema() }),
            required: &["note"],
            build: |args| Ok(Invocation::new("backlinks").positionals(&[required_string(args, "note")?])),
        },
        Tool {
            name: "links",
            description: "List the wiki links a note makes, each resolved to its target note when it exists.",
            read_only: true,
            properties: || json!({ "note": note_schema() }),
            required: &["note"],
            build: |args| Ok(Invocation::new("links").positionals(&[required_string(args, "note")?])),
        },
        Tool {
            name: "note_properties",
            description: "A note's frontmatter properties (typed by its tags' schemas), aliases and tags.",
            read_only: true,
            properties: || json!({ "note": note_schema() }),
            required: &["note"],
            build: |args| Ok(Invocation::new("properties").positionals(&[required_string(args, "note")?])),
        },
        Tool {
            name: "list_notes",
            description: "List notes newest first with their tags, optionally only one tag or one kind (daily or note).",
            read_only: true,
            properties: || json!({
                "tag": { "type": "string", "description": "Only notes with this tag, without the #" },
                "kind": { "type": "string", "enum": ["daily", "note"] },
                "limit": limit_schema(50)
            }),
            required: &[],
            build: |args| {
                Ok(Invocation::new("list")
                    .option("tag", string_arg(args, "tag")?)
                    .option("kind", string_arg(args, "kind")?)
                    .option("limit", limit_arg(args)?))
            },
        },
        Tool {
            name: "recent_notes",
            description: "The most recently updated notes, newest first.",
            read_only: true,
            properties: || json!({ "limit": limit_schema(20) }),
            required: &[],
            build: |args| Ok(Invocation::new("recent").option("limit", limit_arg(args)?)),
        },
        Tool {
            name: "list_tags",
            description: "Every tag with its note count and whether it is a typed collection.",
            read_only: true,
            properties: no_properties,
            required: &[],
            build: |_| Ok(Invocation::new("tags")),
        },
        Tool {
            name: "collection",
            description: "A typed tag's notes as rows with their property values, like a database view.",
            read_only: true,
            properties: || json!({
                "tag": { "type": "string", "description": "The tag, without the #" },
                "sort": { "type": "string", "description": "Property key to sort by" },
                "desc": { "type": "boolean", "description": "Sort descending" },
                "limit": limit_schema(100)
            }),
            required: &["tag"],
            build: |args| {
                let sort = string_arg(args, "sort")?;
                let desc = sort.is_some() && bool_arg(args, "desc")?;
                Ok(Invocation::new("collection")
                    .option("sort", sort)
                    .flag("desc", desc)
                    .option("limit", limit_arg(args)?)
                    .positionals(&[required_string(args, "tag")?]))
            },
        },
        Tool {
            name: "list_tasks",
            description: "The graph's open tasks with their notes and due dates; `all` includes completed ones.",
            read_only: true,
            properties: || json!({ "all": { "type": "boolean" }, "limit": limit_schema(200) }),
            required: &[],
            build: |args| {
                Ok(Invocation::new("tasks")
                    .flag("all", bool_arg(args, "all")?)
                    .option("limit", limit_arg(args)?))
            },
        },
        Tool {
            name: "graph_info",
            description: "The notes folder at a glance: its root, note counts, and whether the index is current.",
            read_only: true,
            properties: no_properties,
            required: &[],
            build: |_| Ok(Invocation::new("info")),
        },
        Tool {
            name: "capture",
            description: "Append one bullet (or an open task) to today's daily note, creating it if needed, or to another note with `to`.",
            read_only: false,
            properties: || json!({
                "text": { "type": "string", "description": "One line; line breaks collapse to spaces" },
                "task": { "type": "boolean", "description": "Add an open task instead of a bullet" },
                "to": note_schema()
            }),
            required: &["text"],
            build: |args| {
                Ok(Invocation::new("capture")
                    .flag("task", bool_arg(args, "task")?)
                    .option("to", string_arg(args, "to")?)
                    .positionals(&[required_string(args, "text")?]))
            },
        },
        Tool {
            name: "append_to_note",
            description: "Append a Markdown block to the end of an existing note, after one blank line.",
            read_only: false,
            properties: || json!({ "note": note_schema(), "markdown": { "type": "string" } }),
            required: &["note", "markdown"],
            build: |args| {
                let mut invocation = Invocation::new("append")
                    .flag("stdin", true)
                    .positionals(&[required_string(args, "note")?]);
                invocation.stdin = Some(required_string(args, "markdown")?);
                Ok(invocation)
            },
        },
        Tool {
            name: "create_note",
            description: "Create a new note with a title, optional Markdown body, tags and properties. Fails if a note with that title already exists.",
            read_only: false,
            properties: || json!({
                "title": { "type": "string" },
                "body": { "type": "string", "description": "Markdown placed under the title" },
                "tags": { "type": "array", "items": { "type": "string" } },
                "properties": { "type": "object", "description": "Frontmatter values by key; lists as arrays" }
            }),
            required: &["title"],
            build: |args| {
                let mut invocation = Invocation::new("new");
                for tag in string_list(args, "tags")? {
                    invocation = invocation.option("tag", Some(tag));
                }
                for assignment in assignments(args, "properties")? {
                    invocation = invocation.option("set", Some(assignment));
                }
                let body = string_arg(args, "body")?.filter(|body| !body.is_empty());
                let mut invocation = invocation
                    .flag("stdin", body.is_some())
                    .positionals(&[required_string(args, "title")?]);
                invocation.stdin = body;
                Ok(invocation)
            },
        },
        Tool {
            name: "set_properties",
            description: "Set or remove frontmatter properties on a note, typed by its tags' schemas (relations by note title).",
            read_only: false,
            properties: || json!({
                "note": note_schema(),
                "set": { "type": "object", "description": "Values by key; lists as arrays" },
                "unset": { "type": "array", "items": { "type": "string" }, "description": "Keys to remove" }
            }),
            required: &["note"],
            build: |args| {
                let pairs = assignments(args, "set")?;
                let unset = string_list(args, "unset")?;
                if pairs.is_empty() && unset.is_empty() {
                    return Err("give `set` or `unset`".to_string());
                }
                let mut invocation = Invocation::new("set");
                for key in unset {
                    invocation = invocation.option("unset", Some(key));
                }
                let mut positionals = vec![required_string(args, "note")?];
                positionals.extend(pairs);
                Ok(invocation.positionals(&positionals))
            },
        },
        Tool {
            name: "tag_note",
            description: "Add a #tag to a note as a trailing tag line.",
            read_only: false,
            properties: || json!({ "note": note_schema(), "tag": { "type": "string" } }),
            required: &["note", "tag"],
            build: |args| {
                Ok(Invocation::new("tag").positionals(&[required_string(args, "note")?, required_string(args, "tag")?]))
            },
        },
        Tool {
            name: "untag_note",
            description: "Remove a note's trailing #tag line (tags inside prose are left alone).",
            read_only: false,
            properties: || json!({ "note": note_schema(), "tag": { "type": "string" } }),
            required: &["note", "tag"],
            build: |args| {
                Ok(Invocation::new("untag").positionals(&[required_string(args, "note")?, required_string(args, "tag")?]))
            },
        },
        Tool {
            name: "complete_task",
            description: "Tick a task off by its text (exact, or a unique part of it); `undo` reopens it.",
            read_only: false,
            properties: || json!({
                "text": { "type": "string" },
                "in": note_schema(),
                "undo": { "type": "boolean" }
            }),
            required: &["text"],
            build: |args| {
                Ok(Invocation::new("done")
                    .option("in", string_arg(args, "in")?)
                    .flag("undo", bool_arg(args, "undo")?)
                    .positionals(&[required_string(args, "text")?]))
            },
        },
    ]
}

fn tool_definition(tool: &Tool) -> Value {
    json!({
        "name": tool.name,
        "description": tool.description,
        "inputSchema": {
            "type": "object",
            "properties": (tool.properties)(),
            "required": tool.required,
            "additionalProperties": false
        },
        "annotations": {
            "readOnlyHint": tool.read_only,
            "destructiveHint": false,
            "openWorldHint": false
        }
    })
}

fn tool_text(text: String, is_error: bool) -> Value {
    json!({ "content": [{ "type": "text", "text": text }], "isError": is_error })
}

/// The MCP request handler, independent of the transport.
pub struct Server<R: Runner> {
    runner: R,
    read_only: bool,
}

impl<R: Runner> Server<R> {
    /// `read_only` hides and refuses every tool that writes.
    pub fn new(runner: R, read_only: bool) -> Self {
        Self { runner, read_only }
    }

    fn available(&self) -> Vec<Tool> {
        tools()
            .into_iter()
            .filter(|tool| tool.read_only || !self.read_only)
            .collect()
    }

    /// Answer one JSON-RPC message. Notifications (no `id`) get `None`.
    pub fn handle(&self, message: &Value) -> Option<Value> {
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
                "tools": self.available().iter().map(tool_definition).collect::<Vec<_>>()
            })),
            "tools/call" => self.call(&params),
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
            "capabilities": { "tools": { "listChanged": false } },
            "serverInfo": { "name": "kore", "title": "Kore", "version": env!("CARGO_PKG_VERSION") },
            "instructions": INSTRUCTIONS
        })
    }

    fn call(&self, params: &Value) -> Result<Value, (i64, String)> {
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
            .available()
            .into_iter()
            .find(|tool| tool.name == name)
            .ok_or((-32602, format!("unknown tool: {name}")))?;
        let invocation = match (tool.build)(args) {
            Ok(invocation) => invocation,
            Err(message) => return Ok(tool_text(message, true)),
        };
        let output = self
            .runner
            .run(&invocation.args, invocation.stdin.as_deref());
        Ok(tool_text(output.text, !output.success))
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
        let response = match serde_json::from_str::<Value>(&line) {
            Ok(Value::Array(batch)) => {
                let replies: Vec<Value> = batch
                    .iter()
                    .filter_map(|message| server.handle(message))
                    .collect();
                if replies.is_empty() {
                    None
                } else {
                    Some(Value::Array(replies))
                }
            }
            Ok(message) => server.handle(&message),
            Err(_) => Some(error_response(Value::Null, -32700, "parse error")),
        };
        if let Some(response) = response {
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
        let unknown = server
            .handle(&json!({ "jsonrpc": "2.0", "id": 2, "method": "resources/list" }))
            .unwrap();
        assert_eq!(unknown["error"]["code"], -32601);
    }
}
