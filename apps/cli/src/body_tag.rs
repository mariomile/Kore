//! Inline `#tag`s in a note's body — the Rust mirror of
//! `packages/core/src/markdown/body-tag.ts` (`bodyHasTag`, `appendBodyTag`)
//! and the tag grammar in `extract.ts`. Tags live in prose, never in
//! frontmatter, so tagging appends one trailing line and untagging removes
//! only such a line — prose is the user's.

use unicode_general_category::{get_general_category, GeneralCategory};

use crate::keys::fold_tag;
use crate::write::line_ending;
use reflect_note_policy::split_frontmatter;

fn is_letter(character: char) -> bool {
    matches!(
        get_general_category(character),
        GeneralCategory::UppercaseLetter
            | GeneralCategory::LowercaseLetter
            | GeneralCategory::TitlecaseLetter
            | GeneralCategory::ModifierLetter
            | GeneralCategory::OtherLetter
    )
}

fn is_number(character: char) -> bool {
    matches!(
        get_general_category(character),
        GeneralCategory::DecimalNumber
            | GeneralCategory::LetterNumber
            | GeneralCategory::OtherNumber
    )
}

/// The `#tag` name grammar (`isTagName`): a letter, then letters, digits,
/// `/`, `_`, `-`.
pub fn is_tag_name(value: &str) -> bool {
    let mut chars = value.chars();
    chars.next().is_some_and(is_letter)
        && chars.all(|character| {
            is_letter(character) || is_number(character) || matches!(character, '/' | '_' | '-')
        })
}

/// Every `#tag` in `text` the grammar accepts: at the start or after
/// whitespace, a letter, then tag characters.
fn tags_in(text: &str) -> Vec<&str> {
    let mut found = Vec::new();
    let mut previous_is_boundary = true;
    let mut iter = text.char_indices().peekable();
    while let Some((index, character)) = iter.next() {
        if character == '#' && previous_is_boundary {
            let start = index + 1;
            let mut end = start;
            let mut first = true;
            for (offset, candidate) in text[start..].char_indices() {
                let ok = if first {
                    is_letter(candidate)
                } else {
                    is_letter(candidate)
                        || is_number(candidate)
                        || matches!(candidate, '/' | '_' | '-')
                };
                if !ok {
                    break;
                }
                first = false;
                end = start + offset + candidate.len_utf8();
            }
            if end > start {
                found.push(&text[start..end]);
                // Skip past the tag so `#a#b` does not restart inside it.
                while iter.peek().is_some_and(|(next, _)| *next < end) {
                    iter.next();
                }
                previous_is_boundary = false;
                continue;
            }
        }
        previous_is_boundary = character.is_whitespace();
    }
    found
}

/// Whether `body` already carries `tag`, folded the way the index folds it.
pub fn body_has_tag(body: &str, tag: &str) -> bool {
    let wanted = fold_tag(tag);
    tags_in(body)
        .into_iter()
        .any(|found| fold_tag(found) == wanted)
}

/// `source` with `#tag` appended on its own trailing line, or `None` when
/// the body already carries the tag (nothing to write).
pub fn append_body_tag(source: &str, tag: &str) -> Option<String> {
    let ending = line_ending(source);
    let split = split_frontmatter(source);
    if body_has_tag(split.body, tag) {
        return None;
    }
    let trimmed = split.body.trim_end();
    let next_body = if trimmed.is_empty() {
        format!("#{tag}{ending}")
    } else {
        format!("{trimmed}{ending}{ending}#{tag}{ending}")
    };
    Some(match split.raw {
        None => next_body,
        Some(raw) => format!("---{ending}{raw}{ending}---{ending}{next_body}"),
    })
}

/// What removing a tag found.
pub enum Untag {
    /// The tag was a standalone trailing line; here is the source without it.
    Removed(String),
    /// The note does not carry the tag.
    Absent,
    /// The tag sits inline in prose; the CLI will not edit that.
    Inline,
}

/// Remove `#tag` when it stands alone on the last non-blank body line
/// (the line `append_body_tag` writes), along with the blank line before it.
pub fn remove_trailing_tag(source: &str, tag: &str) -> Untag {
    let ending = line_ending(source);
    let split = split_frontmatter(source);
    if !body_has_tag(split.body, tag) {
        return Untag::Absent;
    }
    let wanted = fold_tag(tag);
    let trimmed = split.body.trim_end();
    let (before, last_line) = match trimmed.rfind('\n') {
        Some(index) => (&trimmed[..=index], &trimmed[index + 1..]),
        None => ("", trimmed),
    };
    let last_line = last_line.trim_end_matches('\r');
    let standalone = last_line
        .strip_prefix('#')
        .is_some_and(|name| fold_tag(name) == wanted);
    if !standalone {
        return Untag::Inline;
    }
    let mut next_body = before.trim_end().to_string();
    if !next_body.is_empty() {
        next_body.push_str(ending);
    }
    // Other occurrences in prose stay: the trailing line was the one the
    // CLI owns. Report inline when the tag would survive the removal.
    if body_has_tag(&next_body, tag) {
        return Untag::Inline;
    }
    Untag::Removed(match split.raw {
        None => next_body,
        Some(raw) => format!("---{ending}{raw}{ending}---{ending}{next_body}"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tag_grammar_matches_the_indexer() {
        assert!(is_tag_name("book"));
        assert!(is_tag_name("sci-fi/classic_2"));
        assert!(is_tag_name("libri"));
        assert!(!is_tag_name("2book"));
        assert!(!is_tag_name("a b"));
        assert!(!is_tag_name(""));
        assert_eq!(tags_in("a #one, #Two #3 x#no ##x"), vec!["one", "Two"]);
        assert!(body_has_tag("# T\nsee #Book here\n", "book"));
        assert!(!body_has_tag("# T\nsee #bookshelf\n", "book"));
    }

    #[test]
    fn appends_a_trailing_tag_line_once() {
        assert_eq!(
            append_body_tag("---\nid: x\n---\n# T\nbody\n\n", "book").unwrap(),
            "---\nid: x\n---\n# T\nbody\n\n#book\n"
        );
        assert_eq!(append_body_tag("", "book").unwrap(), "#book\n");
        assert!(append_body_tag("# T\n#Book\n", "book").is_none());
    }

    #[test]
    fn removes_only_a_standalone_trailing_tag() {
        match remove_trailing_tag("# T\nbody\n\n#book\n", "Book") {
            Untag::Removed(source) => assert_eq!(source, "# T\nbody\n"),
            _ => panic!("expected removal"),
        }
        assert!(matches!(
            remove_trailing_tag("# T\nbody #book here\n", "book"),
            Untag::Inline
        ));
        assert!(matches!(
            remove_trailing_tag("# T\nbody\n", "book"),
            Untag::Absent
        ));
        assert!(matches!(
            remove_trailing_tag("# T\nsee #book\n\n#book\n", "book"),
            Untag::Inline
        ));
    }
}
