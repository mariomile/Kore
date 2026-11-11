//! The cyber-brain kit's memory tools (Plan 35), served in place of the
//! plain `remember` when the vault keeps memory with its kit.

use serde_json::{json, Value};

use super::tools::{bool_arg, required_string, string_arg, Effect, Invocation, Tool};

/// The memory tools of a vault that keeps memory with its cyber-brain kit
/// (Plan 35). Each runs `kore brain`, which runs the vault's own
/// `brain.mjs`: the same formats, run record and commit as Claude Code or
/// the nightly `dream`, signed with the calling agent's name. They replace
/// the plain `remember` for such a vault.
pub(super) const KIT_TOOL_NAMES: [&str; 5] = [
    "remember",
    "open_loop",
    "update_loop",
    "close_loop",
    "record_decision",
];

pub(super) const KIT_INSTRUCTIONS: &str = "This vault keeps memory with its cyber-brain kit. \
remember, open_loop, update_loop, close_loop and record_decision run the vault's own \
memory script, the same code every agent uses, so use them for every memory write and \
never write memory files, loops or decisions by hand. Dates are YYYY-MM-DD: resolve \
\"Friday\" or \"tomorrow\" yourself from today's date.";

fn kit_text(description: &str) -> Value {
    json!({ "type": "string", "description": description })
}

pub(super) fn kit_tools() -> Vec<Tool> {
    vec![
        Tool {
            name: "remember",
            description: "Keep one durable memory the way the vault's kit does: a fact line `- fact [source: …; since: …]` in the note it belongs to (or the agent inbox, when the vault queues writes), with a run record and a commit. Give `source` (where it came from: a meeting, a chat, a document) for anything but a lesson; give `replaces` with the old line when a fact changes.",
            effect: Effect::Add,
            properties: || json!({
                "text": kit_text("The memory, one line, in the vault's language"),
                "kind": { "type": "string", "enum": ["fact", "block", "observation", "lesson"], "description": "fact (default), block (identity: NOW, USER or SOUL), observation, or lesson (yours)" },
                "source": kit_text("Where it came from"),
                "target": kit_text("The note it belongs in, or NOW/USER/SOUL for a block"),
                "replaces": kit_text("The line this one replaces, kept as was:"),
                "since": kit_text("YYYY-MM-DD the fact holds from (default today)"),
                "now": { "type": "boolean", "description": "The user asked to write it now, even when the vault queues writes" }
            }),
            required: &["text"],
            build: |args| {
                Ok(Invocation::new("brain")
                    .subcommand("remember")
                    .option("kind", Some(string_arg(args, "kind")?.unwrap_or_else(|| "fact".to_string())))
                    .option("text", Some(required_string(args, "text")?))
                    .option("source", string_arg(args, "source")?)
                    .option("target", string_arg(args, "target")?)
                    .option("replaces", string_arg(args, "replaces")?)
                    .option("since", string_arg(args, "since")?)
                    .flag("now", bool_arg(args, "now")?))
            },
        },
        Tool {
            name: "open_loop",
            description: "Open a loop (something someone owes or must come back to) with the vault's kit: it gets an id, lands in the loop list and today's daily note, with a run record and a commit. Dates are YYYY-MM-DD.",
            effect: Effect::Add,
            properties: || json!({
                "title": kit_text("What has to happen, one line"),
                "owner": kit_text("Who owes it (default the user)"),
                "due": kit_text("YYYY-MM-DD it is due"),
                "resurface": kit_text("YYYY-MM-DD to bring it back up"),
                "state": kit_text("Where it stands now"),
                "context": kit_text("The note or meeting it comes from"),
                "status": { "type": "string", "enum": ["open", "waiting-user"] }
            }),
            required: &["title"],
            build: |args| {
                Ok(Invocation::new("brain")
                    .subcommand("loop")
                    .subcommand("open")
                    .option("title", Some(required_string(args, "title")?))
                    .option("owner", string_arg(args, "owner")?)
                    .option("due", string_arg(args, "due")?)
                    .option("resurface", string_arg(args, "resurface")?)
                    .option("state", string_arg(args, "state")?)
                    .option("context", string_arg(args, "context")?)
                    .option("status", string_arg(args, "status")?))
            },
        },
        Tool {
            name: "update_loop",
            description: "Update an open loop by its id: where it stands, its status, when to resurface it, or who owns it.",
            effect: Effect::Add,
            properties: || json!({
                "id": kit_text("The loop's id"),
                "state": kit_text("Where it stands now"),
                "status": { "type": "string", "enum": ["open", "waiting-user", "closed"] },
                "resurface": kit_text("YYYY-MM-DD to bring it back up"),
                "owner": kit_text("Who owes it now")
            }),
            required: &["id"],
            build: |args| {
                Ok(Invocation::new("brain")
                    .subcommand("loop")
                    .subcommand("update")
                    .option("id", Some(required_string(args, "id")?))
                    .option("state", string_arg(args, "state")?)
                    .option("status", string_arg(args, "status")?)
                    .option("resurface", string_arg(args, "resurface")?)
                    .option("owner", string_arg(args, "owner")?))
            },
        },
        Tool {
            name: "close_loop",
            description: "Close a loop by its id with how it ended.",
            effect: Effect::Add,
            properties: || json!({
                "id": kit_text("The loop's id"),
                "outcome": kit_text("How it ended, one line")
            }),
            required: &["id", "outcome"],
            build: |args| {
                Ok(Invocation::new("brain")
                    .subcommand("loop")
                    .subcommand("close")
                    .option("id", Some(required_string(args, "id")?))
                    .option("outcome", Some(required_string(args, "outcome")?)))
            },
        },
        Tool {
            name: "record_decision",
            description: "Record a decision the user made as its own decision note, the vault's kit format, with a run record and a commit. Only for a decision the user actually took, not a hypothesis.",
            effect: Effect::Add,
            properties: || json!({
                "title": kit_text("Short title"),
                "description": kit_text("One line: what was decided about"),
                "decision": kit_text("What was decided"),
                "context": kit_text("Why it came up"),
                "options": kit_text("The options considered"),
                "tradeoffs": kit_text("What it costs, what it buys")
            }),
            required: &["title", "description", "decision"],
            build: |args| {
                Ok(Invocation::new("brain")
                    .subcommand("decision")
                    .subcommand("new")
                    .option("title", Some(required_string(args, "title")?))
                    .option("description", Some(required_string(args, "description")?))
                    .option("decision", Some(required_string(args, "decision")?))
                    .option("context", string_arg(args, "context")?)
                    .option("options", string_arg(args, "options")?)
                    .option("tradeoffs", string_arg(args, "tradeoffs")?))
            },
        },
    ]
}
