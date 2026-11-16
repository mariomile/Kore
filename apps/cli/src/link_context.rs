//! Named relations and the words around a link, for `links`, `backlinks` and
//! `explain`.
//!
//! The index stores each link's span as UTF-16 offsets into the whole file
//! (the core projection runs in JavaScript), plus `relation`: the frontmatter
//! key a header link is the value of (`company: "[[Acme]]"`), NULL for a body
//! link. An agent reading a backlink wants both: *what kind* of edge it is,
//! and *the sentence it came from*, so it can quote its source instead of
//! re-reading the whole note.

use rusqlite::Connection;

/// The longest context returned for one link, in characters. A paragraph
/// longer than this is cut to a window centred on the link.
pub const CONTEXT_MAX_CHARS: usize = 280;

/// Whether this index's `links` table has the `relation` column (migration
/// 0028). An index written by an older app lacks it; the commands then read
/// every link as a plain mention instead of failing.
pub fn links_have_relation(conn: &Connection) -> bool {
    conn.prepare("SELECT 1 FROM pragma_table_info('links') WHERE name = 'relation'")
        .and_then(|mut statement| statement.exists([]))
        .unwrap_or(false)
}

/// The SQL expression for a link's relation: the column, or NULL on an index
/// that predates it. `alias` is the table alias in the query.
pub fn relation_column(has_relation: bool, alias: &str) -> String {
    if has_relation {
        format!("{alias}.relation")
    } else {
        "NULL".to_string()
    }
}

/// Whether two relation names are the same key, ignoring case (`Company`
/// and `company` are one relation; Unicode-aware, so `Città` matches too).
pub fn same_relation(left: &str, right: &str) -> bool {
    left == right || left.to_lowercase() == right.to_lowercase()
}

/// Byte index in `text` of the UTF-16 offset `offset`, clamped to the text
/// and to a char boundary.
pub fn utf16_to_byte(text: &str, offset: i64) -> usize {
    if offset <= 0 {
        return 0;
    }
    let target = offset as usize;
    let mut units = 0usize;
    for (byte, ch) in text.char_indices() {
        if units >= target {
            return byte;
        }
        units += ch.len_utf16();
    }
    text.len()
}

/// The words around one link: its frontmatter line for a relation, the
/// paragraph (or list item line) for a body link, whitespace collapsed and
/// cut to [`CONTEXT_MAX_CHARS`] around the link.
pub fn context_at(content: &str, pos_from: i64, pos_to: i64) -> String {
    let from = utf16_to_byte(content, pos_from);
    let to = utf16_to_byte(content, pos_to).max(from);
    let (start, end) = block_bounds(content, from, to);
    let block = &content[start..end];
    let link_start = from - start;
    let link_end = to - start;
    window(block, link_start, link_end)
}

/// The enclosing block: lines up to the nearest blank line on each side, or
/// just the link's own line when it is a list item or a frontmatter line
/// (each item is its own unit of meaning; a sibling bullet is noise).
fn block_bounds(content: &str, from: usize, to: usize) -> (usize, usize) {
    let line_start = content[..from].rfind('\n').map_or(0, |index| index + 1);
    let line_end = content[to..]
        .find('\n')
        .map_or(content.len(), |index| to + index);
    let line = content[line_start..line_end].trim_start();
    let is_item = line.starts_with("- ")
        || line.starts_with("* ")
        || line.starts_with("+ ")
        || line.starts_with('#')
        || line.starts_with('|')
        || starts_numbered(line);
    if is_item || in_frontmatter(content, from) {
        return (line_start, line_end);
    }
    let mut start = line_start;
    while start > 0 {
        let prev_end = start - 1;
        let prev_start = content[..prev_end].rfind('\n').map_or(0, |index| index + 1);
        let prev = content[prev_start..prev_end].trim();
        if prev.is_empty() || prev == "---" || is_structural(prev) {
            break;
        }
        start = prev_start;
    }
    let mut end = line_end;
    while end < content.len() {
        let next_start = end + 1;
        let next_end = content[next_start..]
            .find('\n')
            .map_or(content.len(), |index| next_start + index);
        let next = content[next_start..next_end].trim();
        if next.is_empty() || is_structural(next) {
            break;
        }
        end = next_end;
    }
    (start, end)
}

fn starts_numbered(line: &str) -> bool {
    let digits = line.bytes().take_while(u8::is_ascii_digit).count();
    digits > 0 && line[digits..].starts_with(". ")
}

/// A line that starts a new block: heading, list item, quote, table, fence.
fn is_structural(line: &str) -> bool {
    line.starts_with('#')
        || line.starts_with("- ")
        || line.starts_with("* ")
        || line.starts_with("+ ")
        || line.starts_with('>')
        || line.starts_with('|')
        || line.starts_with("```")
        || starts_numbered(line)
}

/// Whether `byte` falls inside the file's leading `---` frontmatter block.
fn in_frontmatter(content: &str, byte: usize) -> bool {
    let Some(rest) = content
        .strip_prefix("---\n")
        .or_else(|| content.strip_prefix("---\r\n"))
    else {
        return false;
    };
    let opening = content.len() - rest.len();
    let close = rest
        .match_indices("\n---")
        .map(|(index, _)| opening + index)
        .find(|&index| {
            let after = &content[index + 4..];
            after.is_empty() || after.starts_with('\n') || after.starts_with("\r\n")
        });
    match close {
        Some(close) => byte < close + 1,
        None => false,
    }
}

/// Collapse whitespace and cut to [`CONTEXT_MAX_CHARS`] around the link,
/// marking a cut with `…`.
fn window(block: &str, link_start: usize, link_end: usize) -> String {
    let before = collapse(&block[..link_start]);
    let link = collapse(&block[link_start..link_end]);
    let after = collapse(&block[link_end..]);
    let joined_len = before.chars().count() + link.chars().count() + after.chars().count();
    if joined_len <= CONTEXT_MAX_CHARS {
        return format!("{before}{link}{after}").trim().to_string();
    }
    let room = CONTEXT_MAX_CHARS.saturating_sub(link.chars().count()) / 2;
    let before_chars: Vec<char> = before.chars().collect();
    let after_chars: Vec<char> = after.chars().collect();
    let head: String = if before_chars.len() > room {
        let cut: String = before_chars[before_chars.len() - room..].iter().collect();
        format!("…{}", cut.trim_start())
    } else {
        before
    };
    let tail: String = if after_chars.len() > room {
        let cut: String = after_chars[..room].iter().collect();
        format!("{}…", cut.trim_end())
    } else {
        after
    };
    format!("{head}{link}{tail}").trim().to_string()
}

fn collapse(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut space = false;
    for ch in text.chars() {
        if ch.is_whitespace() {
            space = true;
        } else {
            if space && !out.is_empty() {
                out.push(' ');
            }
            space = false;
            out.push(ch);
        }
    }
    if space && !out.is_empty() {
        out.push(' ');
    }
    // Leading whitespace in a slice is meaningful only between parts.
    if text.starts_with(char::is_whitespace) && !out.is_empty() {
        out.insert(0, ' ');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn span(content: &str, needle: &str) -> (i64, i64) {
        let byte = content.find(needle).expect("needle");
        let from = content[..byte].encode_utf16().count() as i64;
        let to = from + needle.encode_utf16().count() as i64;
        (from, to)
    }

    #[test]
    fn an_index_from_before_relations_reads_links_as_mentions() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE links (source_path TEXT, pos_from INTEGER)")
            .unwrap();
        assert!(!links_have_relation(&conn));
        assert_eq!(relation_column(false, "l"), "NULL");
        conn.execute_batch("ALTER TABLE links ADD COLUMN relation TEXT")
            .unwrap();
        assert!(links_have_relation(&conn));
        assert_eq!(relation_column(true, "l"), "l.relation");
    }

    #[test]
    fn a_body_link_returns_its_paragraph() {
        let content =
            "# Title\n\nFirst para.\n\nWe met at [[Acme]] to talk\nabout pricing.\n\nNext.";
        let (from, to) = span(content, "[[Acme]]");
        assert_eq!(
            context_at(content, from, to),
            "We met at [[Acme]] to talk about pricing."
        );
    }

    #[test]
    fn a_list_item_returns_only_its_line() {
        let content = "- one\n- call [[Acme]] Monday\n- three";
        let (from, to) = span(content, "[[Acme]]");
        assert_eq!(context_at(content, from, to), "- call [[Acme]] Monday");
    }

    #[test]
    fn a_frontmatter_relation_returns_its_line() {
        let content = "---\ncompany: \"[[Acme]]\"\nrole: CEO\n---\n# Ada\n";
        let (from, to) = span(content, "[[Acme]]");
        assert_eq!(context_at(content, from, to), "company: \"[[Acme]]\"");
    }

    #[test]
    fn offsets_are_utf16_so_emoji_and_accents_do_not_shift_the_span() {
        let content = "Caffè 🍵 con [[Luca]] ieri.";
        let (from, to) = span(content, "[[Luca]]");
        assert_eq!(context_at(content, from, to), "Caffè 🍵 con [[Luca]] ieri.");
    }

    #[test]
    fn a_long_paragraph_is_cut_around_the_link() {
        let filler = "parola ".repeat(80);
        let content = format!("{filler}[[Acme]] {filler}");
        let (from, to) = span(&content, "[[Acme]]");
        let context = context_at(&content, from, to);
        assert!(context.contains("[[Acme]]"));
        assert!(context.starts_with('…') && context.ends_with('…'));
        assert!(context.chars().count() <= CONTEXT_MAX_CHARS + 2);
    }
}
