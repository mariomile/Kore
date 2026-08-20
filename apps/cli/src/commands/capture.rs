//! `reflect capture <text>` — the CLI's one write: append a list item to
//! today's daily note, mirroring the app's capture flow (all quick capture
//! lands in the daily note; see `packages/core/src/markdown/append-list-item.ts`).
//! The daily is created on first capture — dailies are lazy by design. A
//! `private: true` daily is refused before anything is read or written, and
//! the write is atomic (temp file + rename) so a crash never truncates a note.
//!
//! Join rule (the line-based mirror of the app's): when the note already ends
//! in a top-level bullet list, the item joins it with the list's own marker —
//! except that a task is always `+ [ ]` (the round marker is what makes it a
//! task, so it only joins a `+` list). Anything else gets a blank line and a
//! fresh list.

use std::fs;
use std::io::Write;
use std::path::Path;

use crate::commands::output::{print_json, CaptureJson};
use crate::error::CliError;
use crate::graph::Graph;
use crate::note_file::ensure_not_private;
use crate::paths::{daily_path, today_date};

/// The note's own line ending, from its first line break (LF for new files).
fn line_ending(content: &str) -> &'static str {
    match content.find('\n') {
        Some(index) if index > 0 && content.as_bytes()[index - 1] == b'\r' => "\r\n",
        _ => "\n",
    }
}

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

/// Write through a sibling temp file + rename so a crash mid-write can never
/// leave a half-written daily note behind.
fn atomic_write(path: &Path, contents: &str) -> Result<(), CliError> {
    let dir = path
        .parent()
        .ok_or_else(|| CliError::Runtime(format!("no parent directory for {}", path.display())))?;
    fs::create_dir_all(dir)?;
    let mut tmp = tempfile::NamedTempFile::new_in(dir)?;
    tmp.write_all(contents.as_bytes())?;
    tmp.flush()?;
    tmp.persist(path)
        .map_err(|err| CliError::Runtime(err.to_string()))?;
    Ok(())
}

pub fn run(graph: &Graph, json: bool, text: &str, task: bool) -> Result<(), CliError> {
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

    let date = today_date();
    let rel_path = daily_path(&date);
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
            date: &date,
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
        assert_eq!(
            append_item("- one\r\n", "two", false),
            "- one\r\n- two\r\n"
        );
        assert_eq!(
            append_item("prose\r\n", "item", false),
            "prose\r\n\r\n- item\r\n"
        );
    }
}
