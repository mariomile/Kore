//! Frontmatter writes for `set`, `tag`, and `new` — the CLI-side counterpart
//! of `upsertFrontmatter` (`packages/core/src/markdown/frontmatter.ts`). The
//! app rewrites the block through a YAML document model that keeps comments,
//! key order, and quoting; Rust has no such emitter here, so this module
//! **splices one top-level key at a time**: a key's lines are replaced in
//! place, a missing key is appended before the closing fence, a deleted key's
//! lines are removed — and every other byte of the block stays as written.
//! The result is re-parsed and each patched key is read back before the
//! caller writes anything; a mismatch refuses rather than corrupts.
//!
//! Like the app, an existing block that does not parse as a YAML mapping is
//! refused: re-serializing a partial parse would drop bytes the user wrote.

use reflect_note_policy::split_frontmatter;
use saphyr::{Scalar, Yaml};

use crate::error::CliError;
use crate::frontmatter_values::{
    entries, format_number, parse_mapping, property_value, PropertyValue,
};
use crate::write::line_ending;

/// One key to set (`Some`) or delete (`None`).
pub type Patch = Vec<(String, Option<PropertyValue>)>;

/// Words the YAML 1.2 core schema (and the app's reader) would not read back
/// as the string they are; quoting keeps them strings.
const SPECIAL_WORDS: [&str; 9] = ["true", "false", "null", "~", "yes", "no", "on", "off", ""];

/// Render a string the way it must be written to read back verbatim: plain
/// when unambiguous, double-quoted (JSON escaping, which YAML accepts) when a
/// leading indicator, a `: ` / ` #` sequence, surrounding whitespace, a line
/// break, or a number/boolean/null reading would change its meaning.
pub fn render_string(text: &str) -> String {
    let needs_quotes = text.trim() != text
        || text
            .chars()
            .next()
            .is_some_and(|first| "-?:,[]{}#&*!|>'\"%@`".contains(first))
        || text.contains(": ")
        || text.contains(" #")
        || text.ends_with(':')
        || text.contains('\n')
        || text.contains('\r')
        || SPECIAL_WORDS.contains(&text.to_ascii_lowercase().as_str())
        || looks_numeric(text);
    if needs_quotes {
        serde_json::to_string(text).unwrap_or_else(|_| format!("\"{text}\""))
    } else {
        text.to_string()
    }
}

/// Would the YAML core schema read `text` as a number (`4`, `4.5`, `1e3`,
/// `0x1f`, `.inf`)? A conservative superset: anything that parses as f64 or
/// starts like a number is quoted.
fn looks_numeric(text: &str) -> bool {
    let candidate = text.trim_start_matches(['+', '-']);
    candidate.parse::<f64>().is_ok()
        || candidate.starts_with("0x")
        || candidate.starts_with("0o")
        || matches!(candidate.to_ascii_lowercase().as_str(), ".inf" | ".nan")
}

/// The lines a key's value occupies in the block (no trailing line ending).
fn render_value(key: &str, value: &PropertyValue, ending: &str) -> String {
    match value {
        PropertyValue::String(text) => format!("{key}: {}", render_string(text)),
        PropertyValue::Number(number) => format!("{key}: {}", format_number(*number)),
        PropertyValue::Bool(flag) => format!("{key}: {flag}"),
        PropertyValue::List(items) => {
            let mut lines = vec![format!("{key}:")];
            for item in items {
                lines.push(format!("  - {}", render_string(item)));
            }
            lines.join(ending)
        }
    }
}

/// The key a top-level line declares (`key:` at column 0, optionally quoted),
/// or `None` for continuation, blank, comment, and sequence lines.
fn top_level_key(line: &str) -> Option<String> {
    let first = line.chars().next()?;
    if first.is_whitespace() || first == '#' || first == '-' {
        return None;
    }
    let (key, rest) = if let Some(quoted) = line.strip_prefix('"') {
        let end = quoted.find('"')?;
        (quoted[..end].to_string(), &quoted[end + 1..])
    } else if let Some(quoted) = line.strip_prefix('\'') {
        let end = quoted.find('\'')?;
        (quoted[..end].to_string(), &quoted[end + 1..])
    } else {
        let end = line.find(':')?;
        (line[..end].trim_end().to_string(), &line[end..])
    };
    let rest = rest.trim_start();
    let rest = rest.strip_prefix(':')?;
    if rest.is_empty() || rest.starts_with(' ') || rest.starts_with('\t') {
        Some(key)
    } else {
        None
    }
}

/// `[start, end)` line indexes of the block a top-level key occupies: its own
/// line plus every following line that is blank or indented, minus trailing
/// blank lines (they separate keys and stay put).
fn key_span(lines: &[&str], start: usize) -> (usize, usize) {
    let mut end = start + 1;
    while end < lines.len() {
        let line = lines[end];
        let continuation =
            line.trim().is_empty() || line.starts_with(' ') || line.starts_with('\t');
        if !continuation {
            break;
        }
        end += 1;
    }
    while end > start + 1 && lines[end - 1].trim().is_empty() {
        end -= 1;
    }
    (start, end)
}

/// Apply `patch` to the raw block text (no fences), returning the new raw
/// text, or `None` when nothing is left worth a block.
fn patch_block(raw: &str, patch: &Patch, ending: &str) -> Option<String> {
    let mut lines: Vec<String> = raw.split(ending).map(str::to_string).collect();
    // A block that ended with a line ending has one empty trailing "line";
    // keep the shape and restore it on join.
    for (key, value) in patch {
        let borrowed: Vec<&str> = lines.iter().map(String::as_str).collect();
        let found = borrowed
            .iter()
            .position(|line| top_level_key(line).as_deref() == Some(key.as_str()));
        match (found, value) {
            (Some(start), Some(value)) => {
                let (start, end) = key_span(&borrowed, start);
                let rendered = render_value(key, value, ending);
                lines.splice(start..end, rendered.split(ending).map(str::to_string));
            }
            (Some(start), None) => {
                let (start, end) = key_span(&borrowed, start);
                lines.drain(start..end);
            }
            (None, Some(value)) => {
                while lines.last().is_some_and(|line| line.trim().is_empty()) {
                    lines.pop();
                }
                let rendered = render_value(key, value, ending);
                lines.extend(rendered.split(ending).map(str::to_string));
            }
            (None, None) => {}
        }
    }
    let meaningful = lines
        .iter()
        .any(|line| !line.trim().is_empty() && !line.trim_start().starts_with('#'));
    let keeps_comments = lines.iter().any(|line| line.trim_start().starts_with('#'));
    if !meaningful && !keeps_comments {
        return None;
    }
    while lines.last().is_some_and(|line| line.trim().is_empty()) {
        lines.pop();
    }
    Some(lines.join(ending))
}

/// Read one key back from a parsed block as the value the patch intended.
fn read_back(raw: &str, key: &str) -> Option<PropertyValue> {
    let mapping = parse_mapping(raw)?;
    entries(&mapping)
        .into_iter()
        .find(|(candidate, _)| candidate == key)
        .and_then(|(_, node)| property_value(node))
}

/// Whether the parsed block still carries `key` at all (a deleted key must
/// be gone, not merely untyped).
fn has_key(raw: &str, key: &str) -> bool {
    parse_mapping(raw).is_some_and(|mapping| {
        mapping
            .get(&Yaml::Value(Scalar::String(key.into())))
            .is_some()
    })
}

/// Apply `patch` to a note's full source, returning the new source. The body
/// is preserved byte-for-byte. An empty patch is a no-op.
pub fn patch_source(source: &str, patch: &Patch) -> Result<String, CliError> {
    if patch.is_empty() {
        return Ok(source.to_string());
    }
    let ending = line_ending(source);
    let split = split_frontmatter(source);
    let existing_raw = split.raw.unwrap_or("");
    if split.raw.is_some() && parse_mapping(existing_raw).is_none() {
        return Err(CliError::Runtime(
            "refusing to update invalid YAML frontmatter — fix the note's frontmatter first"
                .to_string(),
        ));
    }
    let next_raw = patch_block(existing_raw, patch, ending);

    if let Some(raw) = &next_raw {
        for (key, value) in patch {
            match value {
                Some(expected) => {
                    if read_back(raw, key).as_ref() != Some(expected) {
                        return Err(CliError::Runtime(format!(
                            "frontmatter write for '{key}' did not read back as written — nothing was changed"
                        )));
                    }
                }
                None => {
                    if has_key(raw, key) {
                        return Err(CliError::Runtime(format!(
                            "frontmatter key '{key}' could not be removed — nothing was changed"
                        )));
                    }
                }
            }
        }
    }

    let body = split.body;
    Ok(match next_raw {
        None => body.to_string(),
        Some(raw) => format!("---{ending}{raw}{ending}---{ending}{body}"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(key: &str, value: PropertyValue) -> (String, Option<PropertyValue>) {
        (key.to_string(), Some(value))
    }

    fn text(value: &str) -> PropertyValue {
        PropertyValue::String(value.to_string())
    }

    #[test]
    fn creates_a_block_when_the_note_has_none() {
        let patched =
            patch_source("# Dune\n", &vec![set("rating", PropertyValue::Number(4.0))]).unwrap();
        assert_eq!(patched, "---\nrating: 4\n---\n# Dune\n");
    }

    #[test]
    fn replaces_a_scalar_in_place_keeping_neighbours_and_comments() {
        let source = "---\n# the id\nid: abc\nrating: 3 # old\nauthor: Le Guin\n---\n# Body\n";
        let patched =
            patch_source(source, &vec![set("rating", PropertyValue::Number(4.5))]).unwrap();
        assert_eq!(
            patched,
            "---\n# the id\nid: abc\nrating: 4.5\nauthor: Le Guin\n---\n# Body\n"
        );
    }

    #[test]
    fn replaces_and_writes_block_lists() {
        let source = "---\ngenres:\n  - scifi\n  - classic\nauthor: Herbert\n---\nbody\n";
        let patched = patch_source(
            source,
            &vec![
                set("genres", PropertyValue::List(vec!["scifi".into()])),
                set(
                    "people",
                    PropertyValue::List(vec!["[[Ann]]".into(), "Bob: x".into()]),
                ),
            ],
        )
        .unwrap();
        assert_eq!(
            patched,
            "---\ngenres:\n  - scifi\nauthor: Herbert\npeople:\n  - \"[[Ann]]\"\n  - \"Bob: x\"\n---\nbody\n"
        );
    }

    #[test]
    fn deleting_the_last_key_removes_the_block() {
        let source = "---\nrating: 3\n---\nbody\n";
        let patched = patch_source(source, &vec![("rating".to_string(), None)]).unwrap();
        assert_eq!(patched, "body\n");
        let untouched = patch_source("body\n", &vec![("rating".to_string(), None)]).unwrap();
        assert_eq!(untouched, "body\n");
    }

    #[test]
    fn quotes_strings_that_would_change_meaning() {
        assert_eq!(render_string("Le Guin"), "Le Guin");
        assert_eq!(render_string("2026-01-02"), "2026-01-02");
        assert_eq!(render_string("4.5"), "\"4.5\"");
        assert_eq!(render_string("true"), "\"true\"");
        assert_eq!(render_string("[[Dune]]"), "\"[[Dune]]\"");
        assert_eq!(render_string("a: b"), "\"a: b\"");
        assert_eq!(render_string("- item"), "\"- item\"");
        assert_eq!(render_string(""), "\"\"");
        let patched = patch_source("body\n", &vec![set("title-ish", text("4.5"))]).unwrap();
        assert_eq!(
            read_back(split_frontmatter(&patched).raw.unwrap(), "title-ish"),
            Some(text("4.5"))
        );
    }

    #[test]
    fn keeps_the_notes_crlf_endings() {
        let source = "---\r\nauthor: X\r\n---\r\nbody\r\n";
        let patched =
            patch_source(source, &vec![set("rating", PropertyValue::Number(2.0))]).unwrap();
        assert_eq!(patched, "---\r\nauthor: X\r\nrating: 2\r\n---\r\nbody\r\n");
    }

    #[test]
    fn refuses_invalid_yaml_and_leaves_bodies_alone() {
        let source = "---\nauthor: [unclosed\n---\nbody\n";
        let error =
            patch_source(source, &vec![set("rating", PropertyValue::Number(2.0))]).unwrap_err();
        assert!(error.to_string().contains("invalid YAML"));
        let source = "---\n- a list\n---\nbody\n";
        assert!(patch_source(source, &vec![set("rating", PropertyValue::Number(2.0))]).is_err());
    }
}
