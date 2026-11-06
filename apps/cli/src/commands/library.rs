//! `kore library`: the read-only Library of folders outside the vault (the
//! agents' homes). See `crate::library` for what is listed and what is never
//! read. Needs no graph: the Library belongs to the user, not to one vault.

use std::path::PathBuf;

use serde_json::json;

use crate::commands::output::{print_content, print_json};
use crate::error::CliError;
use crate::library::{self, Source};

#[derive(Debug, clap::Subcommand)]
pub enum LibraryAction {
    /// List the Library's folders with their Markdown file counts (default)
    Sources,
    /// Add a folder, or with --known every agent home found in $HOME
    Add {
        /// The folder to read (e.g. ~/.claude)
        folder: Option<PathBuf>,
        /// Its short name, the first segment of its paths (default: from the folder)
        #[arg(long)]
        name: Option<String>,
        /// Add ~/.claude, ~/.codex, ~/.agents, ~/.gemini, ~/.cursor, ~/.copilot, ~/.config/opencode when present
        #[arg(long, conflicts_with_all = ["folder", "name"])]
        known: bool,
    },
    /// Stop reading a folder (its files are untouched)
    Remove {
        /// The folder's Library name
        name: String,
    },
    /// List the Markdown files in one folder, or in all of them
    Files {
        /// The folder's Library name
        source: Option<String>,
    },
    /// Every line containing an exact text, across the Library
    Grep {
        /// The text to find, matched literally
        text: String,
        /// Only this folder
        #[arg(long)]
        source: Option<String>,
        /// Match regardless of case
        #[arg(long, short = 'i')]
        ignore_case: bool,
        /// Maximum number of matching lines
        #[arg(long, default_value_t = 200)]
        limit: usize,
    },
    /// Print one file, by the path `files` or `grep` gave (e.g. claude/CLAUDE.md)
    Read {
        /// `<folder name>/<path inside it>`
        path: String,
    },
}

fn config_path() -> Result<PathBuf, CliError> {
    library::default_path().ok_or_else(|| {
        CliError::Usage(
            "set KORE_LIBRARIES_FILE or HOME to say where the Library list lives".into(),
        )
    })
}

fn pick(sources: Vec<Source>, name: Option<&str>) -> Result<Vec<Source>, CliError> {
    let Some(name) = name else {
        return Ok(sources);
    };
    let picked: Vec<Source> = sources.into_iter().filter(|s| s.name == name).collect();
    if picked.is_empty() {
        return Err(CliError::NotFound(format!(
            "no Library folder named {name:?}"
        )));
    }
    Ok(picked)
}

pub fn run(action: Option<&LibraryAction>, json: bool) -> Result<(), CliError> {
    let config = config_path()?;
    match action.unwrap_or(&LibraryAction::Sources) {
        LibraryAction::Sources => {
            let sources = library::load(&config);
            let rows: Vec<_> = sources
                .iter()
                .map(|source| {
                    let (files, truncated) = library::files(source);
                    (source, files.len(), truncated)
                })
                .collect();
            if json {
                let listed: Vec<_> = rows
                    .iter()
                    .map(|(source, count, truncated)| {
                        json!({ "name": source.name, "path": source.path, "files": count, "truncated": truncated })
                    })
                    .collect();
                return print_json(&json!({ "file": config, "sources": listed }));
            }
            if rows.is_empty() {
                crate::commands::warn(
                    "the Library is empty; add a folder with `kore library add --known`",
                );
            }
            for (source, count, truncated) in rows {
                let more = if truncated { "+" } else { "" };
                println!(
                    "{}\t{}{more}\t{}",
                    source.name,
                    count,
                    source.path.display()
                );
            }
            Ok(())
        }
        LibraryAction::Add {
            folder,
            name,
            known,
        } => {
            let added = if *known {
                let home = std::env::var_os("HOME")
                    .filter(|home| !home.is_empty())
                    .ok_or_else(|| CliError::Usage("HOME is not set".into()))?;
                library::add_known(&config, &PathBuf::from(home))?
            } else {
                let folder = folder
                    .as_deref()
                    .ok_or_else(|| CliError::Usage("name a folder, or pass --known".into()))?;
                vec![library::add(&config, folder, name.as_deref())?]
            };
            if json {
                return print_json(&json!({ "added": added }));
            }
            for source in &added {
                println!("{}\t{}", source.name, source.path.display());
            }
            if added.is_empty() {
                crate::commands::warn("nothing new to add");
            }
            Ok(())
        }
        LibraryAction::Remove { name } => {
            if !library::remove(&config, name)? {
                return Err(CliError::NotFound(format!(
                    "no Library folder named {name:?}"
                )));
            }
            if json {
                return print_json(&json!({ "removed": name }));
            }
            Ok(())
        }
        LibraryAction::Files { source } => {
            let sources = pick(library::load(&config), source.as_deref())?;
            let mut all = Vec::new();
            let mut truncated = false;
            for source in &sources {
                let (files, cut) = library::files(source);
                truncated |= cut;
                all.extend(files);
            }
            if json {
                return print_json(&json!({ "files": all, "truncated": truncated }));
            }
            for file in &all {
                println!("{}", file.path);
            }
            if truncated {
                crate::commands::warn(format!(
                    "a folder has more than {} Markdown files; only the first were listed",
                    library::MAX_FILES
                ));
            }
            Ok(())
        }
        LibraryAction::Grep {
            text,
            source,
            ignore_case,
            limit,
        } => {
            if text.is_empty() {
                return Err(CliError::Usage("the text to find is empty".to_string()));
            }
            let sources = pick(library::load(&config), source.as_deref())?;
            let (matches, truncated) = library::grep(&sources, text, *ignore_case, *limit);
            if json {
                return print_json(
                    &json!({ "text": text, "truncated": truncated, "matches": matches }),
                );
            }
            for found in &matches {
                println!("{}:{}:{}", found.path, found.line, found.text);
            }
            if truncated {
                crate::commands::warn(format!("stopped at {limit} matches; raise --limit"));
            }
            Ok(())
        }
        LibraryAction::Read { path } => {
            let content = library::read(&library::load(&config), path)?;
            if json {
                return print_json(&json!({ "path": path, "content": content }));
            }
            print_content(&content);
            Ok(())
        }
    }
}
