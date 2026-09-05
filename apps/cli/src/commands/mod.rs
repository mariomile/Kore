//! The commands. Shared rules live here: stdout carries only data, warnings
//! go to stderr, and `show`/`path`/`open` degrade to a file scan when the
//! index is missing or unusable (`search` and `tasks` are the commands that
//! require it). `capture` is the one command that writes.

pub mod backlinks;
pub mod capture;
pub mod collection;
pub mod info;
pub mod links;
pub mod list;
pub mod new;
pub mod open;
pub mod path;
pub mod properties;
pub mod recent;
pub mod search;
pub mod show;
pub mod tags;
pub mod tasks;
pub mod today;

mod output;

use std::fmt::Display;
use std::path::Path;

use reflect_index_schema::{INDEX_FILE, REFLECT_DIR};

use crate::error::CliError;
use crate::index::{detect_staleness, open_read_only, IndexOpen, OpenIndex, Staleness};
use crate::note_file::read_note;

fn warn(message: impl Display) {
    eprintln!("reflect: warning: {message}");
}

/// The privacy re-check shared by the index-backed commands: the index row
/// said public, but the file's own frontmatter is the truth — a note flagged
/// private after the last index run must not surface. Unreadable, missing,
/// and iCloud-placeholder files fail closed: their current privacy state
/// cannot be proven from disk.
fn still_public_on_disk(root: &Path, rel_path: &str) -> bool {
    read_note(root, rel_path).is_ok()
}

/// Open the index for `show`/`path` resolution; a missing or unusable index
/// is not fatal there — resolution falls back to scanning the files.
fn open_index_for_resolution(root: &Path) -> Option<OpenIndex> {
    match open_read_only(root) {
        IndexOpen::Opened(open) => {
            if open.newer_schema {
                warn("the index schema is newer than this CLI — update Kore");
            }
            Some(open)
        }
        IndexOpen::Missing => None,
        IndexOpen::Unusable(message) => {
            warn(format!("{message}; falling back to a file scan"));
            None
        }
    }
}

/// Open the index for a command that cannot work without it (exit 4 when
/// missing or unusable), warn about a newer schema, and measure staleness
/// (warned once here; the JSON shapes carry it as `stale`).
fn require_index(root: &Path) -> Result<(OpenIndex, Staleness), CliError> {
    let opened = match open_read_only(root) {
        IndexOpen::Opened(opened) => opened,
        IndexOpen::Missing => {
            return Err(CliError::NoIndex(format!(
                "no index at {REFLECT_DIR}/{INDEX_FILE} — open this graph in Kore to build it"
            )))
        }
        IndexOpen::Unusable(message) => return Err(CliError::NoIndex(message)),
    };
    if opened.newer_schema {
        warn("the index schema is newer than this CLI — update Kore");
    }
    let staleness = detect_staleness(&opened.conn, root)?;
    if staleness.is_stale() {
        warn(format!(
            "the index may be stale ({} file(s) differ from it) — open the graph in Kore to refresh",
            staleness.total()
        ));
    }
    Ok((opened, staleness))
}
