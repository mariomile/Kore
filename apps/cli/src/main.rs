//! The `kore` binary: clap surface + exit-code mapping. All behavior lives
//! in the library modules so integration tests exercise the same code paths.

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};

use reflect_cli::error::CliError;
use reflect_cli::{agent_keys, commands, graph, mcp, mcp_http};

/// Read, discover, and capture notes in a Kore graph.
///
/// The graph resolves from --graph, then $KORE_GRAPH, then the nearest
/// ancestor of the current directory containing .reflect/. Notes marked
/// `private: true` are never returned (and never captured into). Exit codes:
/// 0 ok, 1 error, 2 usage, 3 not found or private, 4 index missing
/// (search/tasks).
#[derive(Parser)]
#[command(name = "kore", version)]
struct Cli {
    /// Graph directory (default: nearest ancestor with .reflect/, or $KORE_GRAPH)
    #[arg(long, global = true, value_name = "PATH")]
    graph: Option<PathBuf>,

    /// Emit JSON on stdout instead of human-readable text
    #[arg(long, global = true)]
    json: bool,

    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Print today's daily note
    Today {
        /// Print the daily note's absolute path instead (works before the file exists)
        #[arg(long)]
        path: bool,
    },
    /// Full-text search over the graph's search index
    Search {
        /// Search terms and the app's operators (#tag, "phrase", -word, path:, file:, [key:value], is:daily, links:, updated:)
        query: String,
        /// Maximum number of results
        #[arg(long, default_value_t = 20)]
        limit: usize,
        /// hybrid (words and meaning, the default), lexical (words only), or
        /// semantic (meaning only). Hybrid falls back to lexical when the app
        /// has not built semantic vectors or the model is not on this machine.
        #[arg(long, value_enum, default_value_t = commands::search::SearchMode::Hybrid)]
        mode: commands::search::SearchMode,
    },
    /// Print a note, resolved by date, path, id, title, or alias
    Show {
        /// A YYYY-MM-DD date, graph-relative path, note id, title, or alias
        note: String,
    },
    /// Resolve a note to its absolute path (for piping into editors/tools)
    Path {
        /// A YYYY-MM-DD date, graph-relative path, note id, title, or alias
        note: String,
    },
    /// Open a note in the Kore app via its kore:// deep link
    Open {
        /// A YYYY-MM-DD date, graph-relative path, note id, title, or alias
        note: String,
        /// Print the URL without launching the app
        #[arg(long)]
        print: bool,
    },
    /// List the graph's tasks (open ones by default), from the search index
    Tasks {
        /// Include completed tasks too
        #[arg(long)]
        all: bool,
        /// Maximum number of tasks
        #[arg(long, default_value_t = 200)]
        limit: usize,
    },
    /// Append a list item to today's daily note (or --to any note)
    Capture {
        /// The text of the item (one line; line breaks collapse to spaces)
        #[arg(required_unless_present = "stdin")]
        text: Option<String>,
        /// Read the text from stdin instead of the argument
        #[arg(long, conflicts_with = "text")]
        stdin: bool,
        /// Append an open task (`+ [ ]`) instead of a plain bullet
        #[arg(long)]
        task: bool,
        /// Target note (date, path, id, title, or alias) instead of today's daily
        #[arg(long, value_name = "NOTE")]
        to: Option<String>,
    },
    /// List the notes linking to a note, from the search index
    Backlinks {
        /// A YYYY-MM-DD date, graph-relative path, note id, title, or alias
        note: String,
    },
    /// List the most recently updated notes, newest first
    Recent {
        /// Maximum number of notes
        #[arg(long, default_value_t = 20)]
        limit: usize,
    },
    /// List a typed tag's collection (its notes with their property values)
    Collection {
        /// The tag (case-insensitive, without the #)
        tag: String,
        /// Property key to sort by (missing values last)
        #[arg(long, value_name = "KEY")]
        sort: Option<String>,
        /// Sort descending (with --sort)
        #[arg(long, requires = "sort")]
        desc: bool,
        /// Maximum number of rows
        #[arg(long, default_value_t = 100)]
        limit: usize,
    },
    /// The graph and its index at a glance (works without an index)
    Info,
    /// The vault's agent contract (AGENTS.md) and a map of its folders: what
    /// an agent reads first (works without an index)
    Guide {
        /// Write a starter AGENTS.md (and a CLAUDE.md importing it) when the
        /// vault has none; never overwrites
        #[arg(long)]
        init: bool,
    },
    /// List every tag with its note count and whether it is a collection
    Tags,
    /// List notes newest first, with their tags
    List {
        /// Only notes carrying this tag (without the #)
        #[arg(long, value_name = "TAG")]
        tag: Option<String>,
        /// Only this kind of note
        #[arg(long, value_name = "KIND", value_parser = ["daily", "note"])]
        kind: Option<String>,
        /// Maximum number of notes
        #[arg(long, default_value_t = 50)]
        limit: usize,
    },
    /// Print a note's frontmatter properties (typed), aliases, and tags
    Properties {
        /// A YYYY-MM-DD date, graph-relative path, note id, title, or alias
        note: String,
    },
    /// List the wiki links a note makes, resolved through the index
    Links {
        /// A YYYY-MM-DD date, graph-relative path, note id, title, or alias
        note: String,
    },
    /// Create a note under notes/ with a title-derived filename
    New {
        /// The note's title (becomes the H1 and the filename slug)
        title: String,
        /// Seed the body from a templates/ file (by name or title),
        /// with {{date}}/{{date:iso}}/{{time}}/{{title}} expanded
        #[arg(long, value_name = "TEMPLATE")]
        template: Option<String>,
        /// Tag the note (repeatable; a typed tag seeds its template and stamps `created`)
        #[arg(long = "tag", value_name = "TAG")]
        tags: Vec<String>,
        /// Set a frontmatter property (repeatable), typed by the tags' schemas
        #[arg(long = "set", value_name = "KEY=VALUE")]
        sets: Vec<String>,
        /// Read the body from stdin (placed under the H1)
        #[arg(long, conflicts_with = "template")]
        stdin: bool,
    },
    /// Set frontmatter properties, typed by the note's tag schemas
    Set {
        /// A YYYY-MM-DD date, graph-relative path, note id, title, or alias
        note: String,
        /// key=value pairs (lists comma-separated; relations by title)
        #[arg(value_name = "KEY=VALUE")]
        assignments: Vec<String>,
        /// Remove a property (repeatable)
        #[arg(long = "unset", value_name = "KEY")]
        unset: Vec<String>,
    },
    /// Add a #tag to a note as a trailing line (typed tags stamp `created`)
    Tag {
        /// A YYYY-MM-DD date, graph-relative path, note id, title, or alias
        note: String,
        /// The tag (with or without the #)
        tag: String,
    },
    /// Remove a note's trailing #tag line (inline tags in prose are left alone)
    Untag {
        /// A YYYY-MM-DD date, graph-relative path, note id, title, or alias
        note: String,
        /// The tag (with or without the #)
        tag: String,
    },
    /// Tick a task off by its text (or back on with --undo)
    Done {
        /// The task's text (exact, else a unique part of it)
        text: String,
        /// Only tasks in this note
        #[arg(long = "in", value_name = "NOTE")]
        in_note: Option<String>,
        /// Reopen a completed task instead
        #[arg(long)]
        undo: bool,
    },
    /// Append a markdown block to a note (after one blank line)
    Append {
        /// A YYYY-MM-DD date, graph-relative path, note id, title, or alias
        note: String,
        /// The markdown to append
        #[arg(required_unless_present = "stdin")]
        text: Option<String>,
        /// Read the markdown from stdin instead of the argument
        #[arg(long, conflicts_with = "text")]
        stdin: bool,
    },
    /// Build or refresh the search index without the app (needs Node 22+)
    Index {
        /// Rebuild every row instead of reconciling what changed
        #[arg(long)]
        rebuild: bool,
    },
    /// Print every line containing an exact text, across all notes (no index needed)
    Grep {
        /// The text to find, matched literally
        text: String,
        /// Match regardless of case
        #[arg(long, short = 'i')]
        ignore_case: bool,
        /// Maximum number of matching lines
        #[arg(long, default_value_t = 200)]
        limit: usize,
    },
    /// The shortest chain of wiki links between two notes, either direction
    Route {
        /// Where the route starts (date, path, id, title, or alias)
        from: String,
        /// Where it ends
        to: String,
        /// Give up beyond this many links
        #[arg(long, default_value_t = 6)]
        max_hops: usize,
    },
    /// A note's place in the graph: properties, tags, outline, links, backlinks
    Explain {
        /// A YYYY-MM-DD date, graph-relative path, note id, title, or alias
        note: String,
    },
    /// List the vault's agent skills (agents/skills/), or print one by name
    Skills {
        /// The skill's slug or title
        name: Option<String>,
    },
    /// The note open in the Kore app and the note tabs beside it
    Active,
    /// Replace one exact passage of a note's body (or append, with an empty
    /// --old). Nothing is written unless --old occurs in the body exactly
    /// once, so an edit never lands on a note that changed since it was read
    Edit {
        /// A YYYY-MM-DD date, graph-relative path, note id, title, or alias
        note: String,
        /// The exact current text to replace, unique in the note ("" appends)
        #[arg(long, value_name = "TEXT", allow_hyphen_values = true)]
        old: String,
        /// The replacement text
        #[arg(long, value_name = "TEXT", allow_hyphen_values = true)]
        new: String,
    },
    /// Serve the graph to AI agents as an MCP server (stdio, or HTTP with --http)
    Mcp {
        /// Expose only the tools that read; refuse every write
        #[arg(long)]
        read_only: bool,
        /// Serve over HTTP on this address (e.g. 127.0.0.1:8765) instead of
        /// stdio; requires KORE_MCP_TOKEN
        #[arg(long, value_name = "ADDR")]
        http: Option<String>,
        /// Public HTTPS origin clients use (the tunnel's URL); defaults to the Host header
        #[arg(long, value_name = "URL", requires = "http")]
        public_url: Option<String>,
        /// Extra OAuth redirect URI to allow, besides Claude's and loopback ones
        #[arg(long = "redirect-uri", value_name = "URI", requires = "http")]
        redirect_uris: Vec<String>,
    },
    /// Named agents' own keys for `kore mcp --http` (no app needed)
    Keys {
        #[command(subcommand)]
        action: KeysAction,
    },
}

#[derive(Subcommand)]
enum KeysAction {
    /// Give an agent its own key, printed once; read-only unless --write
    Add {
        /// The name its writes are signed with (e.g. "Grok bot")
        name: String,
        /// Let this agent use the tools that write
        #[arg(long)]
        write: bool,
    },
    /// List the agents that have a key (never the keys)
    List,
    /// Remove an agent's key; it is disconnected at its next request
    Remove {
        /// The agent's name
        name: String,
    },
}

/// `kore keys`: edits the keys file, so it needs no graph.
fn run_keys(action: &KeysAction, json: bool) -> Result<(), CliError> {
    let path = agent_keys::default_path().ok_or_else(|| {
        CliError::Usage("set KORE_MCP_KEYS_FILE or HOME to say where agent keys live".into())
    })?;
    match action {
        KeysAction::Add { name, write } => {
            let agent = agent_keys::add(&path, name, *write)?;
            if json {
                println!(
                    "{}",
                    serde_json::json!({ "name": agent.name, "key": agent.key, "write": agent.write })
                );
            } else {
                println!("{}", agent.key);
                eprintln!(
                    "kore: key for {:?} ({}), shown once. Give it to the agent with the server's /setup.md.",
                    agent.name,
                    if agent.write { "read and write" } else { "read-only" }
                );
            }
        }
        KeysAction::List => {
            let agents = agent_keys::load(&path);
            if json {
                let listed: Vec<_> = agents
                    .iter()
                    .map(|agent| serde_json::json!({ "name": agent.name, "write": agent.write }))
                    .collect();
                println!("{}", serde_json::json!({ "file": path, "agents": listed }));
            } else {
                for agent in &agents {
                    println!(
                        "{}\t{}",
                        agent.name,
                        if agent.write { "write" } else { "read" }
                    );
                }
            }
        }
        KeysAction::Remove { name } => {
            if !agent_keys::remove(&path, name)? {
                return Err(CliError::Usage(format!(
                    "no agent called {name:?} has a key"
                )));
            }
            if json {
                println!("{}", serde_json::json!({ "removed": name }));
            }
        }
    }
    Ok(())
}

fn run(cli: &Cli) -> Result<(), CliError> {
    if let Command::Keys { action } = &cli.command {
        return run_keys(action, cli.json);
    }
    let graph = match &cli.command {
        Command::Index { .. } => graph::resolve_for_index(cli.graph.as_deref())?,
        _ => graph::resolve(cli.graph.as_deref())?,
    };
    match &cli.command {
        Command::Keys { action } => run_keys(action, cli.json),
        Command::Today { path } => commands::today::run(&graph, cli.json, *path),
        Command::Search { query, limit, mode } => {
            commands::search::run(&graph, cli.json, query, *limit, *mode)
        }
        Command::Show { note } => commands::show::run(&graph, cli.json, note),
        Command::Path { note } => commands::path::run(&graph, cli.json, note),
        Command::Open { note, print } => commands::open::run(&graph, cli.json, note, *print),
        Command::Tasks { all, limit } => commands::tasks::run(&graph, cli.json, *all, *limit),
        Command::Capture {
            text,
            stdin,
            task,
            to,
        } => commands::capture::run(
            &graph,
            cli.json,
            text.as_deref(),
            *stdin,
            *task,
            to.as_deref(),
        ),
        Command::Backlinks { note } => commands::backlinks::run(&graph, cli.json, note),
        Command::Recent { limit } => commands::recent::run(&graph, cli.json, *limit),
        Command::Collection {
            tag,
            sort,
            desc,
            limit,
        } => commands::collection::run(&graph, cli.json, tag, sort.as_deref(), *desc, *limit),
        Command::Info => commands::info::run(&graph, cli.json),
        Command::Guide { init } => commands::guide::run(&graph, cli.json, *init),
        Command::Tags => commands::tags::run(&graph, cli.json),
        Command::List { tag, kind, limit } => {
            commands::list::run(&graph, cli.json, tag.as_deref(), kind.as_deref(), *limit)
        }
        Command::Properties { note } => commands::properties::run(&graph, cli.json, note),
        Command::Links { note } => commands::links::run(&graph, cli.json, note),
        Command::Grep {
            text,
            ignore_case,
            limit,
        } => commands::grep::run(&graph, cli.json, text, *ignore_case, *limit),
        Command::Route { from, to, max_hops } => {
            commands::route::run(&graph, cli.json, from, to, *max_hops)
        }
        Command::Explain { note } => commands::explain::run(&graph, cli.json, note),
        Command::Skills { name } => commands::skills::run(&graph, cli.json, name.as_deref()),
        Command::Active => commands::active::run(&graph, cli.json),
        Command::New {
            title,
            template,
            tags,
            sets,
            stdin,
        } => commands::new::run(
            &graph,
            cli.json,
            title,
            template.as_deref(),
            tags,
            sets,
            *stdin,
        ),
        Command::Set {
            note,
            assignments,
            unset,
        } => commands::set::run(&graph, cli.json, note, assignments, unset),
        Command::Tag { note, tag } => commands::tag::run_tag(&graph, cli.json, note, tag),
        Command::Untag { note, tag } => commands::tag::run_untag(&graph, cli.json, note, tag),
        Command::Done {
            text,
            in_note,
            undo,
        } => commands::done::run(&graph, cli.json, text, in_note.as_deref(), *undo),
        Command::Append { note, text, stdin } => {
            commands::append::run(&graph, cli.json, note, text.as_deref(), *stdin)
        }
        Command::Index { rebuild } => commands::index::run(&graph.root, cli.json, *rebuild),
        Command::Edit { note, old, new } => commands::edit::run(&graph, cli.json, note, old, new),
        Command::Mcp {
            read_only,
            http,
            public_url,
            redirect_uris,
        } => {
            let runner = mcp::ProcessRunner {
                exe: std::env::current_exe()?,
                graph: graph.root.clone(),
            };
            let server = mcp::Server::new(runner, *read_only);
            let Some(address) = http else {
                mcp::serve(&server, std::io::stdin().lock(), std::io::stdout().lock())?;
                return Ok(());
            };
            let secret = std::env::var("KORE_MCP_TOKEN").unwrap_or_default();
            if secret.trim().len() < mcp_http::MIN_SECRET_LEN {
                return Err(CliError::Usage(format!(
                    "set KORE_MCP_TOKEN to a secret of at least {} characters (e.g. `openssl rand -hex 32`)",
                    mcp_http::MIN_SECRET_LEN
                )));
            }
            let agents =
                agent_keys::parse_env(&std::env::var("KORE_MCP_AGENTS").unwrap_or_default())?;
            let options = mcp_http::HttpOptions {
                secret: secret.trim().to_string(),
                public_url: public_url.clone(),
                extra_redirects: redirect_uris.clone(),
                agents,
                keys_file: agent_keys::default_path(),
            };
            mcp_http::serve(mcp_http::HttpServer::new(server, options), address)?;
            Ok(())
        }
    }
}

fn main() -> ExitCode {
    match run(&Cli::parse()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("kore: {err}");
            ExitCode::from(err.exit_code())
        }
    }
}
