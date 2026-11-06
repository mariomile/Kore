//! `kore edit <note> --old <text> --new <text>` — replace one exact passage
//! of a note's body, or append when `--old` is empty: the CLI's twin of the
//! in-app chat's `edit_note` (`applyNoteEdit`,
//! `packages/core/src/ai/chat/note-edit.ts`), with the same refusals.
//!
//! The expected text is the guard. The note is read, the passage must occur
//! in the body exactly once, and only then is the result written
//! (atomically). If the note changed since the agent read it — the user
//! typed in the app, another agent got there first — the old text no longer
//! matches and nothing is written; the agent re-reads and tries again. So an
//! edit can never land on top of a change it has not seen.
//!
//! Frontmatter is out of reach (properties go through `set`), and private
//! notes are refused like every other write.

use crate::commands::open_index_for_resolution;
use crate::commands::output::{print_json, EditJson};
use crate::commands::resolve_existing;
use crate::error::CliError;
use crate::graph::Graph;
use crate::write::{line_ending, update_note};
use reflect_note_policy::split_frontmatter;

/// The refusals, worded like the chat's so an agent reads the same advice.
pub const NOT_FOUND: &str =
    "the text to replace was not found in the note — re-read the note and pass its exact current text";
pub const AMBIGUOUS: &str =
    "the text to replace appears more than once in the note — include more \
     surrounding lines so it matches exactly once";
pub const NO_CHANGE: &str = "the edit changes nothing";

/// Text from an agent in the note's own line ending: an agent that read a
/// CRLF note through JSON usually sends back LF.
fn in_line_ending(text: &str, ending: &str) -> String {
    if ending == "\r\n" && !text.contains("\r\n") {
        text.replace('\n', "\r\n")
    } else {
        text.to_string()
    }
}

/// Apply one edit to a note's source: the whole note back (frontmatter
/// untouched), or why it was refused. The twin of `applyNoteEdit`.
pub fn apply_edit(source: &str, old_text: &str, new_text: &str) -> Result<String, CliError> {
    let body = split_frontmatter(source).body;
    let header = &source[..source.len() - body.len()];
    let ending = line_ending(source);
    let old_text = in_line_ending(old_text, ending);
    let new_text = in_line_ending(new_text, ending);
    let next_body = if old_text.is_empty() {
        if body.is_empty() || body.ends_with('\n') {
            format!("{body}{new_text}")
        } else {
            format!("{body}{ending}{new_text}")
        }
    } else {
        match body.matches(old_text.as_str()).count() {
            0 => return Err(CliError::Usage(NOT_FOUND.to_string())),
            1 => body.replacen(&old_text, &new_text, 1),
            _ => return Err(CliError::Usage(AMBIGUOUS.to_string())),
        }
    };
    if next_body == body {
        return Err(CliError::Usage(NO_CHANGE.to_string()));
    }
    Ok(format!("{header}{next_body}"))
}

pub fn run(
    graph: &Graph,
    json: bool,
    note_arg: &str,
    old_text: &str,
    new_text: &str,
) -> Result<(), CliError> {
    let index = open_index_for_resolution(&graph.root);
    let rel_path = resolve_existing(&graph.root, note_arg, index.as_ref().map(|open| &open.conn))?;
    // `update_note` re-reads the file, and `apply_edit` matches against that
    // read, so the guard checks the note as it is at write time. Privacy is
    // re-checked on the same read: a note made private after resolution
    // takes no edit.
    update_note(&graph.root, &rel_path, |source| {
        if crate::note_file::parse_note_meta(&rel_path, source).private {
            return Err(CliError::Private(format!("note is private: {rel_path}")));
        }
        apply_edit(source, old_text, new_text)
    })?;
    let absolute = graph.root.join(&rel_path);
    if json {
        return print_json(&EditJson {
            path: &rel_path,
            absolute_path: absolute.display().to_string(),
            appended: old_text.is_empty(),
        });
    }
    println!("{}", absolute.display());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn refusal(result: Result<String, CliError>) -> String {
        match result {
            Err(CliError::Usage(message)) => message,
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    #[test]
    fn replaces_one_exact_passage_and_leaves_the_rest() {
        let source = "---\ntitle: T\n---\n# T\n\nOld line.\nKeep me.\n";
        assert_eq!(
            apply_edit(source, "Old line.", "New line.").unwrap(),
            "---\ntitle: T\n---\n# T\n\nNew line.\nKeep me.\n"
        );
    }

    #[test]
    fn refuses_a_passage_that_is_missing_repeated_or_unchanged() {
        assert_eq!(refusal(apply_edit("a\nb\n", "c", "d")), NOT_FOUND);
        assert_eq!(refusal(apply_edit("x\nx\n", "x", "y")), AMBIGUOUS);
        assert_eq!(refusal(apply_edit("a\n", "a", "a")), NO_CHANGE);
        assert_eq!(refusal(apply_edit("a\n", "", "")), NO_CHANGE);
    }

    #[test]
    fn frontmatter_is_out_of_reach() {
        let source = "---\nstatus: draft\n---\nstatus: draft\n";
        // Only the body copy matches, so the edit is unambiguous and the
        // frontmatter keeps its value.
        assert_eq!(
            apply_edit(source, "status: draft", "status: done").unwrap(),
            "---\nstatus: draft\n---\nstatus: done\n"
        );
        assert_eq!(
            refusal(apply_edit("---\nkey: v\n---\nbody\n", "key: v", "key: w")),
            NOT_FOUND
        );
    }

    #[test]
    fn appends_when_the_old_text_is_empty() {
        assert_eq!(apply_edit("a\n", "", "b\n").unwrap(), "a\nb\n");
        assert_eq!(apply_edit("a", "", "b").unwrap(), "a\nb");
        assert_eq!(apply_edit("", "", "b").unwrap(), "b");
    }

    #[test]
    fn speaks_the_notes_line_ending() {
        assert_eq!(
            apply_edit("# T\r\none\r\ntwo\r\n", "one\ntwo", "uno\ndue").unwrap(),
            "# T\r\nuno\r\ndue\r\n"
        );
    }
}
