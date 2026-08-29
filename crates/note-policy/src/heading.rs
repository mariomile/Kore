//! First-H1 title extraction — the Rust mirror of `deriveTitle`'s heading
//! step in `packages/core/src/markdown/extract.ts`. `pulldown-cmark` gives
//! CommonMark semantics, so a `# line` inside a code fence is never read as
//! a heading.

use pulldown_cmark::{Event, HeadingLevel, Parser, Tag};

/// The TS `unescapeMarkdownText` (`plain-text.ts`): a backslash before ASCII
/// punctuation resolves to that character; any other backslash stays literal.
fn unescape_markdown_text(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars();
    while let Some(ch) = chars.next() {
        if ch == '\\' {
            if let Some(next) = chars.clone().next() {
                if next.is_ascii_punctuation() {
                    out.push(next);
                    chars.next();
                    continue;
                }
            }
        }
        out.push(ch);
    }
    out
}

/// The TS `cleanHeadingText`: setext headings keep their first line; ATX
/// headings lose the leading hashes and any trailing closing hashes; both
/// resolve backslash escapes like the TS extractor.
fn clean_heading_text(raw: &str) -> String {
    let raw = raw
        .strip_suffix('\n')
        .map(|text| text.strip_suffix('\r').unwrap_or(text))
        .unwrap_or(raw);
    if let Some(newline_at) = raw.find('\n') {
        return unescape_markdown_text(raw[..newline_at].trim());
    }
    let text = raw.trim_start();
    let text = text.trim_start_matches('#');
    let text = text.trim_start_matches([' ', '\t']);
    let text = text.trim_end_matches([' ', '\t']);
    let text = text.trim_end_matches('#');
    unescape_markdown_text(text.trim())
}

/// First level-1 heading with non-empty text, cleaned like the TS extractor
/// (raw source slice, so inline markup is kept verbatim). pulldown-cmark gives
/// CommonMark semantics — a `# line` inside a code fence is not a heading.
pub fn first_h1(body: &str) -> Option<String> {
    for (event, range) in Parser::new(body).into_offset_iter() {
        if let Event::Start(Tag::Heading {
            level: HeadingLevel::H1,
            ..
        }) = event
        {
            let text = clean_heading_text(&body[range]);
            if !text.is_empty() {
                return Some(text);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::first_h1;

    #[test]
    fn finds_the_first_atx_h1() {
        assert_eq!(
            first_h1("intro\n\n# The *Heading* [[Link]]\n"),
            Some("The *Heading* [[Link]]".to_string())
        );
    }

    #[test]
    fn finds_a_setext_h1() {
        assert_eq!(
            first_h1("Setext Title\n===\nbody\n"),
            Some("Setext Title".to_string())
        );
    }

    #[test]
    fn h1_inside_a_code_fence_is_not_a_heading() {
        assert_eq!(first_h1("```\n# not a heading\n```\n"), None);
    }

    #[test]
    fn a_lower_level_heading_is_not_an_h1() {
        assert_eq!(first_h1("## only an h2\n"), None);
    }

    #[test]
    fn closing_hashes_and_whitespace_are_stripped() {
        assert_eq!(
            first_h1("#   Spaced Out  ##\n"),
            Some("Spaced Out".to_string())
        );
    }

    #[test]
    fn an_empty_h1_is_skipped_for_a_later_one() {
        assert_eq!(
            first_h1("#\n\n# Real Title\n"),
            Some("Real Title".to_string())
        );
    }

    #[test]
    fn backslash_escapes_resolve_like_the_ts_extractor() {
        assert_eq!(
            first_h1("# Meeting \\[[Ada Lovelace|Ada]]\n"),
            Some("Meeting [[Ada Lovelace|Ada]]".to_string())
        );
        assert_eq!(
            first_h1("Setext \\*Title\\*\n===\n"),
            Some("Setext *Title*".to_string())
        );
    }
}
