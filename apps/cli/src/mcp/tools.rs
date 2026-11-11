//! The MCP tool table: each tool's definition and how its arguments become
//! one `kore` subcommand's argv (see the parent module for the contract).

use serde_json::{json, Map, Value};

/// What a tool does to the vault, which decides its MCP annotations and
/// whether `--read-only` keeps it.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Effect {
    Read,
    /// Writes that only add or set structure (append, create, one property,
    /// one tag line, one task marker): existing prose survives.
    Add,
    /// Replaces existing text (`edit_note`): annotated destructive, so
    /// clients that confirm destructive calls ask the user first.
    Replace,
}

/// One tool: its MCP definition and how its arguments become argv.
pub(super) struct Tool {
    pub(super) name: &'static str,
    pub(super) description: &'static str,
    pub(super) effect: Effect,
    /// JSON Schema `properties` and `required` for the input.
    pub(super) properties: fn() -> Value,
    pub(super) required: &'static [&'static str],
    pub(super) build: fn(&Map<String, Value>) -> Result<Invocation, String>,
}

/// argv (from the subcommand on) plus optional stdin.
pub(super) struct Invocation {
    pub(super) args: Vec<String>,
    pub(super) stdin: Option<String>,
}

impl Invocation {
    pub(super) fn new(subcommand: &str) -> Self {
        Self {
            args: vec![subcommand.to_string()],
            stdin: None,
        }
    }

    pub(super) fn flag(mut self, name: &str, on: bool) -> Self {
        if on {
            self.args.push(format!("--{name}"));
        }
        self
    }

    pub(super) fn option(mut self, name: &str, value: Option<String>) -> Self {
        // `--name=value` in one entry: clap would read a separate value
        // that starts with `-` as another flag.
        if let Some(value) = value {
            self.args.push(format!("--{name}={value}"));
        }
        self
    }

    /// A fixed nested subcommand (`library grep`), before any option.
    pub(super) fn subcommand(mut self, name: &str) -> Self {
        self.args.push(name.to_string());
        self
    }

    /// Positionals go after `--` so a value beginning with `-` is never read
    /// as a flag.
    pub(super) fn positionals(mut self, values: &[String]) -> Self {
        self.args.push("--".to_string());
        self.args.extend(values.iter().cloned());
        self
    }
}

pub(super) fn string_arg(args: &Map<String, Value>, key: &str) -> Result<Option<String>, String> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(text)) => Ok(Some(text.clone())),
        Some(_) => Err(format!("`{key}` must be a string")),
    }
}

pub(super) fn required_string(args: &Map<String, Value>, key: &str) -> Result<String, String> {
    match string_arg(args, key)? {
        Some(text) if !text.trim().is_empty() => Ok(text),
        _ => Err(format!("`{key}` is required")),
    }
}

pub(super) fn bool_arg(args: &Map<String, Value>, key: &str) -> Result<bool, String> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(false),
        Some(Value::Bool(on)) => Ok(*on),
        Some(_) => Err(format!("`{key}` must be a boolean")),
    }
}

pub(super) fn limit_arg(args: &Map<String, Value>) -> Result<Option<String>, String> {
    match args.get("limit") {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(number)) => match number.as_u64() {
            Some(limit) if limit > 0 => Ok(Some(limit.to_string())),
            _ => Err("`limit` must be a positive integer".to_string()),
        },
        Some(_) => Err("`limit` must be a positive integer".to_string()),
    }
}

pub(super) fn string_list(args: &Map<String, Value>, key: &str) -> Result<Vec<String>, String> {
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
pub(super) fn assignments(args: &Map<String, Value>, key: &str) -> Result<Vec<String>, String> {
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

pub(super) fn note_schema() -> Value {
    json!({ "type": "string", "description": "A YYYY-MM-DD date, graph-relative path, note title, or alias" })
}

pub(super) fn limit_schema(default: u64) -> Value {
    json!({ "type": "integer", "minimum": 1, "description": format!("Maximum results (default {default})") })
}

pub(super) fn no_properties() -> Value {
    json!({})
}

pub(super) fn tools() -> Vec<Tool> {
    vec![
        Tool {
            name: "vault_guide",
            description: "Start here, once per session, before reading or writing. Returns the vault's agent contract (the user's rules for every agent: where memory, decisions and new notes go, what not to touch; null when the vault has none) and a map of its folders with note counts and where daily notes live. Follow the contract over your own defaults.",
            effect: Effect::Read,
            properties: no_properties,
            required: &[],
            build: |_| Ok(Invocation::new("guide")),
        },
        Tool {
            name: "search",
            description: "Search every note by words and by meaning (hybrid, like the Kore app's own AI chat): a question in plain language (\"what do I know about X\", \"notes on pricing decisions\") finds notes that discuss it even without the exact words. Returns paths, titles, snippets and, for meaning matches, the heading above the passage; `mode` in the result says whether meaning search ran (it needs semantic search turned on in the app). The query also takes Kore's search operators, which filter both kinds of match: #tag or tag:#tag (nested tags included), -#tag, \"exact phrase\", -word, path:CRM/, file:name, [key] or [key:value], is:daily, is:pinned, links:Note, linked-from:Note, updated:>YYYY-MM-DD. Filters alone list matching notes newest first.",
            effect: Effect::Read,
            properties: || json!({
                "query": { "type": "string", "description": "A question or search terms, plus any operators, e.g. tag:#type/person who works on pricing" },
                "limit": limit_schema(20),
                "mode": { "type": "string", "enum": ["hybrid", "lexical", "semantic"], "description": "hybrid (default): words and meaning; lexical: exact words only; semantic: meaning only" }
            }),
            required: &["query"],
            build: |args| {
                let query = required_string(args, "query")?;
                let mode = match string_arg(args, "mode")?.as_deref() {
                    None => None,
                    Some(mode @ ("hybrid" | "lexical" | "semantic")) => Some(mode.to_string()),
                    Some(_) => return Err("`mode` must be hybrid, lexical, or semantic".to_string()),
                };
                Ok(Invocation::new("search")
                    .option("limit", limit_arg(args)?)
                    .option("mode", mode)
                    .positionals(&[query]))
            },
        },
        Tool {
            name: "read_note",
            description: "Read one note's full Markdown content, with its path, title and daily date.",
            effect: Effect::Read,
            properties: || json!({ "note": note_schema() }),
            required: &["note"],
            build: |args| Ok(Invocation::new("show").positionals(&[required_string(args, "note")?])),
        },
        Tool {
            name: "today",
            description: "Read today's daily note. Fails when it does not exist yet; capture creates it.",
            effect: Effect::Read,
            properties: no_properties,
            required: &[],
            build: |_| Ok(Invocation::new("today")),
        },
        Tool {
            name: "backlinks",
            description: "List the notes that link to a note.",
            effect: Effect::Read,
            properties: || json!({ "note": note_schema() }),
            required: &["note"],
            build: |args| Ok(Invocation::new("backlinks").positionals(&[required_string(args, "note")?])),
        },
        Tool {
            name: "links",
            description: "List the wiki links a note makes, each resolved to its target note when it exists.",
            effect: Effect::Read,
            properties: || json!({ "note": note_schema() }),
            required: &["note"],
            build: |args| Ok(Invocation::new("links").positionals(&[required_string(args, "note")?])),
        },
        Tool {
            name: "note_properties",
            description: "A note's frontmatter properties (typed by its tags' schemas), aliases and tags.",
            effect: Effect::Read,
            properties: || json!({ "note": note_schema() }),
            required: &["note"],
            build: |args| Ok(Invocation::new("properties").positionals(&[required_string(args, "note")?])),
        },
        Tool {
            name: "list_notes",
            description: "List notes newest first with their tags, optionally only one tag or one kind (daily or note).",
            effect: Effect::Read,
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
            effect: Effect::Read,
            properties: || json!({ "limit": limit_schema(20) }),
            required: &[],
            build: |args| Ok(Invocation::new("recent").option("limit", limit_arg(args)?)),
        },
        Tool {
            name: "list_tags",
            description: "Every tag with its note count and whether it is a typed collection.",
            effect: Effect::Read,
            properties: no_properties,
            required: &[],
            build: |_| Ok(Invocation::new("tags")),
        },
        Tool {
            name: "collection",
            description: "A typed tag's notes as rows with their property values, like a database view.",
            effect: Effect::Read,
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
            effect: Effect::Read,
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
            effect: Effect::Read,
            properties: no_properties,
            required: &[],
            build: |_| Ok(Invocation::new("info")),
        },
        Tool {
            name: "grep_notes",
            description: "Every line, in every note, that contains an exact text, with its path and line number. Use it when you need all occurrences (open tasks naming a person, every mention of an amount) rather than the top-ranked notes `search` returns.",
            effect: Effect::Read,
            properties: || json!({
                "text": { "type": "string", "description": "Matched literally, not as a pattern" },
                "ignore_case": { "type": "boolean" },
                "limit": limit_schema(200)
            }),
            required: &["text"],
            build: |args| {
                Ok(Invocation::new("grep")
                    .flag("ignore-case", bool_arg(args, "ignore_case")?)
                    .option("limit", limit_arg(args)?)
                    .positionals(&[required_string(args, "text")?]))
            },
        },
        Tool {
            name: "path_between_notes",
            description: "How two notes are connected: the shortest chain of wiki links between them, followed in either direction, each step saying whether it links to or is linked from the previous note. found is false when no chain exists within max_hops.",
            effect: Effect::Read,
            properties: || json!({
                "from": note_schema(),
                "to": note_schema(),
                "max_hops": { "type": "integer", "minimum": 1, "description": "Give up beyond this many links (default 6)" }
            }),
            required: &["from", "to"],
            build: |args| {
                let max_hops = match args.get("max_hops") {
                    None | Some(Value::Null) => None,
                    Some(value) => match value.as_u64() {
                        Some(hops) if hops > 0 => Some(hops.to_string()),
                        _ => return Err("`max_hops` must be a positive integer".to_string()),
                    },
                };
                Ok(Invocation::new("route")
                    .option("max-hops", max_hops)
                    .positionals(&[required_string(args, "from")?, required_string(args, "to")?]))
            },
        },
        Tool {
            name: "explain_note",
            description: "One note's place in the graph in a single call: title, aliases, tags, typed properties, word count, its headings, the notes it links to and the notes linking to it. Cheaper than read_note plus links plus backlinks when you need to understand a note before using it.",
            effect: Effect::Read,
            properties: || json!({ "note": note_schema() }),
            required: &["note"],
            build: |args| Ok(Invocation::new("explain").positionals(&[required_string(args, "note")?])),
        },
        Tool {
            name: "list_skills",
            description: "The procedures the user taught their agents, kept in the vault under agents/skills/: each skill's name and its description of when to use it. When a task matches a description, call load_skill and follow it.",
            effect: Effect::Read,
            properties: no_properties,
            required: &[],
            build: |_| Ok(Invocation::new("skills")),
        },
        Tool {
            name: "load_skill",
            description: "The full text of one vault skill, by the name list_skills gives (or its title). Follow its steps for the rest of the task.",
            effect: Effect::Read,
            properties: || json!({ "name": { "type": "string" } }),
            required: &["name"],
            build: |args| Ok(Invocation::new("skills").positionals(&[required_string(args, "name")?])),
        },
        Tool {
            name: "library_sources",
            description: "The user's Library: folders outside the vault that Kore reads but never writes, usually the homes of their other agents (~/.claude, ~/.codex, ~/.agents…), each with its Markdown file count. Use it to find what the user's agents already know: their rules (CLAUDE.md, AGENTS.md), skills and memory files. Only on this machine.",
            effect: Effect::Read,
            properties: no_properties,
            required: &[],
            build: |_| Ok(Invocation::new("library").subcommand("sources")),
        },
        Tool {
            name: "library_files",
            description: "The Markdown files in one Library folder (or all of them), as `<folder>/<path>` for library_read.",
            effect: Effect::Read,
            properties: || json!({ "source": { "type": "string", "description": "A folder name from library_sources; omit for every folder" } }),
            required: &[],
            build: |args| {
                let invocation = Invocation::new("library").subcommand("files");
                Ok(match string_arg(args, "source")? {
                    Some(source) => invocation.positionals(&[source]),
                    None => invocation,
                })
            },
        },
        Tool {
            name: "library_grep",
            description: "Every line containing an exact text across the Library's Markdown files, with file and line number. Use it to find which agent rule or skill already covers something.",
            effect: Effect::Read,
            properties: || json!({
                "text": { "type": "string", "description": "Matched literally" },
                "source": { "type": "string", "description": "Only this folder" },
                "ignore_case": { "type": "boolean" },
                "limit": limit_schema(200)
            }),
            required: &["text"],
            build: |args| {
                Ok(Invocation::new("library")
                    .subcommand("grep")
                    .flag("ignore-case", bool_arg(args, "ignore_case")?)
                    .option("source", string_arg(args, "source")?)
                    .option("limit", limit_arg(args)?)
                    .positionals(&[required_string(args, "text")?]))
            },
        },
        Tool {
            name: "library_read",
            description: "The full text of one Library file, by the `<folder>/<path>` library_files or library_grep gave (e.g. claude/CLAUDE.md). Read-only: to change it, ask the user.",
            effect: Effect::Read,
            properties: || json!({ "path": { "type": "string" } }),
            required: &["path"],
            build: |args| {
                Ok(Invocation::new("library")
                    .subcommand("read")
                    .positionals(&[required_string(args, "path")?]))
            },
        },
        Tool {
            name: "active_note",
            description: "The note the user has open in the Kore app right now, and the other note tabs open beside it. Use it when the user says \"this note\" or \"what I'm looking at\". Fails when the app has not shared its state for this vault.",
            effect: Effect::Read,
            properties: no_properties,
            required: &[],
            build: |_| Ok(Invocation::new("active")),
        },
        Tool {
            name: "capture",
            description: "Append one bullet (or an open task) to today's daily note, creating it if needed, or to another note with `to`.",
            effect: Effect::Add,
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
            effect: Effect::Add,
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
            name: "edit_note",
            description: "Replace one exact passage of a note's body with new text (or append, when oldText is empty). read_note first and copy oldText verbatim, whitespace included, with enough surrounding words to occur exactly once. Nothing is written when oldText is missing or repeated, so an edit never overwrites a change made since you read the note (by the user or another agent): re-read and retry. Frontmatter is out of reach (use set_properties); private notes are refused.",
            effect: Effect::Replace,
            properties: || json!({
                "note": note_schema(),
                "oldText": { "type": "string", "description": "The exact current text to replace, unique in the note's body. Empty string: append newText at the end." },
                "newText": { "type": "string", "description": "The replacement Markdown (or the text to append)." }
            }),
            required: &["note", "oldText", "newText"],
            build: |args| {
                let note = required_string(args, "note")?;
                let old_text = string_arg(args, "oldText")?.ok_or("`oldText` is required")?;
                let new_text = string_arg(args, "newText")?.ok_or("`newText` is required")?;
                Ok(Invocation::new("edit")
                    .option("old", Some(old_text))
                    .option("new", Some(new_text))
                    .positionals(&[note]))
            },
        },
        Tool {
            name: "create_note",
            description: "Create a new note with a title, optional Markdown body, tags and properties. Fails if a note with that title already exists.",
            effect: Effect::Add,
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
            effect: Effect::Add,
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
            effect: Effect::Add,
            properties: || json!({ "note": note_schema(), "tag": { "type": "string" } }),
            required: &["note", "tag"],
            build: |args| {
                Ok(Invocation::new("tag").positionals(&[required_string(args, "note")?, required_string(args, "tag")?]))
            },
        },
        Tool {
            name: "untag_note",
            description: "Remove a note's trailing #tag line (tags inside prose are left alone).",
            effect: Effect::Add,
            properties: || json!({ "note": note_schema(), "tag": { "type": "string" } }),
            required: &["note", "tag"],
            build: |args| {
                Ok(Invocation::new("untag").positionals(&[required_string(args, "note")?, required_string(args, "tag")?]))
            },
        },
        Tool {
            name: "complete_task",
            description: "Tick a task off by its text (exact, or a unique part of it); `undo` reopens it.",
            effect: Effect::Add,
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
        Tool {
            name: "remember",
            description: "Keep one durable fact for every agent that uses this vault: a signed bullet with a confidence tag, your name and today's date, in today's daily note or in `note` (follow the vault guide on where facts go). Give `previously` when the fact replaces an older value.",
            effect: Effect::Add,
            properties: || json!({
                "fact": { "type": "string", "description": "One line, in the vault's language" },
                "note": note_schema(),
                "confidence": { "type": "string", "enum": CONFIDENCES, "description": "Default likely" },
                "previously": { "type": "string", "description": "The value this fact replaces" },
                "agent": { "type": "string", "description": "Your name; used only when the server does not already know who you are" }
            }),
            required: &["fact"],
            build: |args| {
                let line = remembered_line(
                    &required_string(args, "fact")?,
                    string_arg(args, "confidence")?.as_deref(),
                    string_arg(args, "previously")?.as_deref(),
                    string_arg(args, "agent")?.as_deref(),
                    &crate::paths::today_date(),
                )?;
                Ok(Invocation::new("capture")
                    .option("to", string_arg(args, "note")?)
                    .positionals(&[line]))
            },
        },
    ]
}

/// Confidence tags of a remembered fact, as the shared facts file uses them.
pub(super) const CONFIDENCES: [&str; 3] = ["certain", "likely", "speculative"];

/// `[likely] The fact (previously: old) — agent, 2026-11-04`: the signed
/// form every agent's memory takes, so who said what and since when is
/// always on the line itself.
pub(super) fn remembered_line(
    fact: &str,
    confidence: Option<&str>,
    previously: Option<&str>,
    agent: Option<&str>,
    date: &str,
) -> Result<String, String> {
    let one_line = |text: &str| text.split_whitespace().collect::<Vec<_>>().join(" ");
    let confidence = confidence.unwrap_or("likely");
    if !CONFIDENCES.contains(&confidence) {
        return Err(format!(
            "`confidence` must be one of {}",
            CONFIDENCES.join(", ")
        ));
    }
    let agent = agent
        .map(one_line)
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "agent".to_string());
    let mut line = format!("[{confidence}] {}", one_line(fact));
    if let Some(old) = previously.map(one_line).filter(|old| !old.is_empty()) {
        line.push_str(&format!(" (previously: {old})"));
    }
    line.push_str(&format!(" — {agent}, {date}"));
    Ok(line)
}

pub(super) fn tool_definition(tool: &Tool) -> Value {
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
            "readOnlyHint": tool.effect == Effect::Read,
            "destructiveHint": tool.effect == Effect::Replace,
            "openWorldHint": false
        }
    })
}

/// `tool`'s invocation for `args`. A named agent's `remember` is signed with
/// the agent's own name, whatever name the arguments claim.
pub(super) fn invocation_for(
    tool: &Tool,
    args: &Map<String, Value>,
    agent: Option<&str>,
) -> Result<Invocation, String> {
    match (agent, tool.name) {
        (Some(agent), "remember") => {
            let mut signed = args.clone();
            signed.insert("agent".to_string(), Value::String(agent.to_string()));
            (tool.build)(&signed)
        }
        _ => (tool.build)(args),
    }
}
