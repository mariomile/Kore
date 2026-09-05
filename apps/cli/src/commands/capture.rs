//! `reflect capture <text>` — the CLI's append-only write: a list item into
//! today's daily note, mirroring the app's capture flow (all quick capture
//! lands in the daily note; see `packages/core/src/markdown/append-list-item.ts`),
//! or into any resolvable note via `--to`. Dailies are created lazily on
//! first capture; any other target must already exist. A `private: true`
//! target is refused before anything is read or written, and the write is
//! atomic (temp file + rename) so a crash never truncates a note.
//!
//! Join rule (the line-based mirror of the app's): when the note already ends
//! in a top-level bullet list, the item joins it with the list's own marker —
//! except that a task is always `+ [ ]` (the round marker is what makes it a
//! task, so it only joins a `+` list). Anything else gets a blank line and a
//! fresh list.

use std::fs;

use crate::commands::{
    open_index_for_resolution,
    output::{print_json, CaptureJson},
};
use crate::error::CliError;
use crate::graph::Graph;
use crate::note_file::ensure_not_private;
use crate::paths::{daily_path, date_from_daily_path, today_date};
use crate::resolve::{resolve_note, ResolvedNote};
use crate::write::{atomic_write, line_ending, read_stdin};

/// The `-`, `+` or `*` of the trailing top-level bullet list, when the note's
/// last non-blank line is one of its items.
fn trailing_list_mark(content: &str) -> Option<char> {
    let line = content.lines().rev().find(|line| !line.trim().is_empty())?;
    let mut chars = line.chars();
    let mark = chars.next()?;
    (matches!(mark, '-' | '+' | '*') && chars.next() == Some(' ')).then_some(mark)
}

/// `content` with `text` appended as one list item (see the module doc).
pub fn append_item(content: &str, text: &str, task: bool) -> String {
    let payload = if task {
        format!("[ ] {text}")
    } else {
        text.to_string()
    };
    let mark = match trailing_list_mark(content) {
        Some(mark) if !task || mark == '+' => Some(if task { '+' } else { mark }),
        _ => None,
    };
    let own = if task { '+' } else { '-' };
    let ending = line_ending(content);
    let body = content.trim_end_matches(['\n', '\r']);
    match mark {
        Some(mark) => format!("{body}{ending}{mark} {payload}{ending}"),
        None if body.is_empty() => format!("{own} {payload}{ending}"),
        None => format!("{body}{ending}{ending}{own} {payload}{ending}"),
    }
}

pub fn run(
    graph: &Graph,
    json: bool,
    text: Option<&str>,
    stdin: bool,
    task: bool,
    to: Option<&str>,
) -> Result<(), CliError> {
    let text = match (text, stdin) {
        (Some(text), false) => text.to_string(),
        (None, true) => read_stdin()?,
        _ => {
            return Err(CliError::Usage(
                "give the text as an argument or on stdin (--stdin), not both".to_string(),
            ))
        }
    };
    // One item is one line: embedded line breaks would smuggle arbitrary
    // markdown structure past the list-item contract.
    let text = text
        .split(['\n', '\r'])
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    if text.is_empty() {
        return Err(CliError::Runtime(
            "nothing to capture — the text is empty".to_string(),
        ));
    }

    // Default target: today's daily, which may not exist yet. A `--to`
    // target resolves like every other `<note>` argument; only a daily
    // reference is allowed to be missing (dailies are lazy, notes are not).
    let (date, rel_path) = match to {
        None => {
            let date = today_date();
            let rel_path = daily_path(&date);
            (Some(date), rel_path)
        }
        Some(target) => {
            let index = open_index_for_resolution(&graph.root);
            let resolved =
                resolve_note(target, &graph.root, index.as_ref().map(|open| &open.conn))?;
            let rel_path = resolved.rel_path().to_string();
            match resolved {
                ResolvedNote::Daily { date, .. } => (Some(date), rel_path),
                ResolvedNote::File { .. } => (
                    date_from_daily_path(&rel_path).map(str::to_string),
                    rel_path,
                ),
            }
        }
    };
    ensure_not_private(&graph.root, &rel_path)?;
    let absolute = graph.root.join(&rel_path);

    let existing = match fs::read_to_string(&absolute) {
        Ok(content) => Some(content),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => None,
        Err(err) => {
            return Err(CliError::Runtime(format!(
                "could not read {rel_path}: {err}"
            )))
        }
    };
    let created = existing.is_none();
    let updated = append_item(existing.as_deref().unwrap_or(""), &text, task);
    atomic_write(&absolute, &updated)?;

    let item = updated
        .trim_end_matches(['\n', '\r'])
        .lines()
        .next_back()
        .unwrap_or_default()
        .to_string();
    if json {
        return print_json(&CaptureJson {
            date: date.as_deref(),
            path: &rel_path,
            absolute_path: absolute.display().to_string(),
            created,
            item: &item,
        });
    }
    println!("{}", absolute.display());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::append_item;

    #[test]
    fn starts_a_note_with_a_single_item() {
        assert_eq!(append_item("", "buy milk", false), "- buy milk\n");
        assert_eq!(append_item("", "pay bill", true), "+ [ ] pay bill\n");
    }

    #[test]
    fn joins_a_trailing_bullet_list_with_its_own_marker() {
        assert_eq!(
            append_item("* one\n* two\n", "three", false),
            "* one\n* two\n* three\n"
        );
        assert_eq!(
            append_item("+ [ ] one\n", "two", true),
            "+ [ ] one\n+ [ ] two\n"
        );
    }

    #[test]
    fn a_task_never_joins_a_non_plus_list() {
        assert_eq!(
            append_item("- one\n- two\n", "pay bill", true),
            "- one\n- two\n\n+ [ ] pay bill\n"
        );
    }

    #[test]
    fn prose_gets_a_blank_line_and_a_fresh_list() {
        assert_eq!(
            append_item("# Plans\n\nsome prose\n", "buy milk", false),
            "# Plans\n\nsome prose\n\n- buy milk\n"
        );
    }

    #[test]
    fn keeps_the_notes_crlf_line_endings() {
        assert_eq!(append_item("- one\r\n", "two", false), "- one\r\n- two\r\n");
        assert_eq!(
            append_item("prose\r\n", "item", false),
            "prose\r\n\r\n- item\r\n"
        );
    }
}
