//! `reflect append <note> [text] [--stdin]` — append a markdown block to a
//! note: the CLI's write for content longer than one list item. The block
//! lands after one blank line, in the note's own line ending, and nothing
//! above it changes. A daily target may not exist yet (created, like
//! `capture`); any other target must. Private targets are refused.

use std::fs;

use crate::commands::open_index_for_resolution;
use crate::commands::output::{print_json, AppendJson};
use crate::error::CliError;
use crate::graph::Graph;
use crate::note_file::ensure_not_private;
use crate::paths::date_from_daily_path;
use crate::resolve::{resolve_note, ResolvedNote};
use crate::write::{atomic_write, line_ending, read_stdin};

/// `content` with `block` appended after one blank line (none when the note
/// is empty), normalized to the note's line ending.
pub fn append_block(content: &str, block: &str) -> String {
    let ending = line_ending(content);
    let block = block
        .replace("\r\n", "\n")
        .trim_matches(['\n', '\r'])
        .replace('\n', ending);
    let body = content.trim_end_matches(['\n', '\r']);
    if body.is_empty() {
        format!("{block}{ending}")
    } else {
        format!("{body}{ending}{ending}{block}{ending}")
    }
}

pub fn run(
    graph: &Graph,
    json: bool,
    note_arg: &str,
    text: Option<&str>,
    stdin: bool,
) -> Result<(), CliError> {
    let block = match (text, stdin) {
        (Some(text), false) => text.to_string(),
        (None, true) => read_stdin()?,
        _ => {
            return Err(CliError::Usage(
                "give the text as an argument or on stdin (--stdin), not both".to_string(),
            ))
        }
    };
    if block.trim().is_empty() {
        return Err(CliError::Usage(
            "nothing to append — the text is empty".to_string(),
        ));
    }

    let index = open_index_for_resolution(&graph.root);
    let resolved = resolve_note(note_arg, &graph.root, index.as_ref().map(|open| &open.conn))?;
    let rel_path = resolved.rel_path().to_string();
    let date = match &resolved {
        ResolvedNote::Daily { date, .. } => Some(date.clone()),
        ResolvedNote::File { .. } => date_from_daily_path(&rel_path).map(str::to_string),
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
    let before = existing.as_deref().unwrap_or("");
    let updated = append_block(before, &block);
    atomic_write(&absolute, &updated)?;

    if json {
        return print_json(&AppendJson {
            date: date.as_deref(),
            path: &rel_path,
            absolute_path: absolute.display().to_string(),
            created,
            bytes_appended: updated.len().saturating_sub(before.len()),
        });
    }
    println!("{}", absolute.display());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::append_block;

    #[test]
    fn appends_after_one_blank_line_in_the_notes_ending() {
        assert_eq!(
            append_block("# T\nbody\n", "## More\n\ntext\n"),
            "# T\nbody\n\n## More\n\ntext\n"
        );
        assert_eq!(append_block("", "first"), "first\n");
        assert_eq!(
            append_block("# T\r\nbody\r\n", "a\nb"),
            "# T\r\nbody\r\n\r\na\r\nb\r\n"
        );
    }
}
