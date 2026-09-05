//! The `reflect` binary: clap surface + exit-code mapping. All behavior lives
//! in the library modules so integration tests exercise the same code paths.

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};

use reflect_cli::error::CliError;
use reflect_cli::{commands, graph};

/// Read, discover, and capture notes in a Kore graph.
///
/// The graph resolves from --graph, then $REFLECT_GRAPH, then the nearest
/// ancestor of the current directory containing .reflect/. Notes marked
/// `private: true` are never returned (and never captured into). Exit codes:
/// 0 ok, 1 error, 2 usage, 3 not found or private, 4 index missing
/// (search/tasks).
#[derive(Parser)]
#[command(name = "reflect", version)]
struct Cli {
    /// Graph directory (default: nearest ancestor with .reflect/, or $REFLECT_GRAPH)
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
        /// Search terms (matched literally, ranked by relevance)
        query: String,
        /// Maximum number of results
        #[arg(long, default_value_t = 20)]
        limit: usize,
    },
    /// Print a note, resolved by date, path, title, or alias
    Show {
        /// A YYYY-MM-DD date, graph-relative path, note title, or alias
        note: String,
    },
    /// Resolve a note to its absolute path (for piping into editors/tools)
    Path {
        /// A YYYY-MM-DD date, graph-relative path, note title, or alias
        note: String,
    },
    /// Open a note in the Kore app via its reflect:// deep link
    Open {
        /// A YYYY-MM-DD date, graph-relative path, note title, or alias
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
        /// Target note (date, path, title, or alias) instead of today's daily
        #[arg(long, value_name = "NOTE")]
        to: Option<String>,
    },
    /// List the notes linking to a note, from the search index
    Backlinks {
        /// A YYYY-MM-DD date, graph-relative path, note title, or alias
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
    /// List every tag with its note count and whether it is a collection
    Tags,
    /// List notes newest first, with their tags
    List {
        /// Only notes carrying this tag (without the #)
        #[arg(long, value_name = "TAG")]
        tag: Option<String>,
        /// Only this kind of note: daily or note
        #[arg(long, value_name = "KIND")]
        kind: Option<String>,
        /// Maximum number of notes
        #[arg(long, default_value_t = 50)]
        limit: usize,
    },
    /// Print a note's frontmatter properties (typed), aliases, and tags
    Properties {
        /// A YYYY-MM-DD date, graph-relative path, note title, or alias
        note: String,
    },
    /// List the wiki links a note makes, resolved through the index
    Links {
        /// A YYYY-MM-DD date, graph-relative path, note title, or alias
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
        /// A YYYY-MM-DD date, graph-relative path, note title, or alias
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
        /// A YYYY-MM-DD date, graph-relative path, note title, or alias
        note: String,
        /// The tag (with or without the #)
        tag: String,
    },
    /// Remove a note's trailing #tag line (inline tags in prose are left alone)
    Untag {
        /// A YYYY-MM-DD date, graph-relative path, note title, or alias
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
        /// A YYYY-MM-DD date, graph-relative path, note title, or alias
        note: String,
        /// The markdown to append
        #[arg(required_unless_present = "stdin")]
        text: Option<String>,
        /// Read the markdown from stdin instead of the argument
        #[arg(long, conflicts_with = "text")]
        stdin: bool,
    },
}

fn run(cli: &Cli) -> Result<(), CliError> {
    let graph = graph::resolve(cli.graph.as_deref())?;
    match &cli.command {
        Command::Today { path } => commands::today::run(&graph, cli.json, *path),
        Command::Search { query, limit } => commands::search::run(&graph, cli.json, query, *limit),
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
        Command::Tags => commands::tags::run(&graph, cli.json),
        Command::List { tag, kind, limit } => {
            commands::list::run(&graph, cli.json, tag.as_deref(), kind.as_deref(), *limit)
        }
        Command::Properties { note } => commands::properties::run(&graph, cli.json, note),
        Command::Links { note } => commands::links::run(&graph, cli.json, note),
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
    }
}

fn main() -> ExitCode {
    match run(&Cli::parse()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("reflect: {err}");
            ExitCode::from(err.exit_code())
        }
    }
}
