//! Title → filename slug derivation — the Rust mirror of
//! `packages/core/src/markdown/slug.ts` (`slugForTitle`), used by
//! `reflect new` so a CLI-created note lands on the same path the app would
//! give it. The TS module is the rule's author; keep this in lockstep.

use unicode_general_category::{get_general_category, GeneralCategory};
use unicode_normalization::UnicodeNormalization;

/// Windows reserved device names (`slug.ts`'s `WINDOWS_RESERVED`).
const WINDOWS_RESERVED: [&str; 22] = [
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
    "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

/// Maximum slug length in code points (`slug.ts`'s `MAX_SLUG_CHARS`).
const MAX_SLUG_CHARS: usize = 60;

/// Exactly `\p{L}` or `\p{N}` — the TS rule. `char::is_alphabetic` would be
/// wrong here: it also matches Other_Alphabetic combining marks (Thai and
/// Devanagari vowel signs), which the TS slug strips, and the two sides must
/// produce identical filenames.
fn is_letter_or_number(character: char) -> bool {
    matches!(
        get_general_category(character),
        GeneralCategory::UppercaseLetter
            | GeneralCategory::LowercaseLetter
            | GeneralCategory::TitlecaseLetter
            | GeneralCategory::ModifierLetter
            | GeneralCategory::OtherLetter
            | GeneralCategory::DecimalNumber
            | GeneralCategory::LetterNumber
            | GeneralCategory::OtherNumber
    )
}

/// Derive the filename slug for a note title: NFC-normalize, lowercase,
/// drop everything but letters/numbers/separators, collapse separator runs
/// (whitespace, `_`, `-`) to single `-`, trim edge dashes, cap at
/// [`MAX_SLUG_CHARS`] code points. Never empty (`untitled`), never a Windows
/// reserved device name. Idempotent: a slug slugs to itself.
pub fn slug_for_title(title: &str) -> String {
    let folded = title.nfc().collect::<String>().to_lowercase();
    let mut dashed = String::new();
    let mut pending_separator = false;
    for character in folded.chars() {
        if character.is_whitespace() || character == '_' || character == '-' {
            pending_separator = true;
        } else if is_letter_or_number(character) {
            if pending_separator && !dashed.is_empty() {
                dashed.push('-');
            }
            pending_separator = false;
            dashed.push(character);
        }
        // Anything else is dropped outright and never becomes a separator.
    }
    let capped = dashed
        .chars()
        .take(MAX_SLUG_CHARS)
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    if capped.is_empty() {
        return "untitled".to_string();
    }
    if WINDOWS_RESERVED.contains(&capped.as_str()) {
        return format!("{capped}-note");
    }
    capped
}

#[cfg(test)]
mod tests {
    use super::slug_for_title;

    /// The examples from `slug.ts`'s own doc — the shared contract.
    #[test]
    fn matches_the_ts_derivation() {
        assert_eq!(slug_for_title("Meeting Notes"), "meeting-notes");
        assert_eq!(slug_for_title("Don't Panic!"), "dont-panic");
        assert_eq!(slug_for_title("日本語ノート"), "日本語ノート");
        assert_eq!(slug_for_title("🎉🎉🎉"), "untitled");
        assert_eq!(slug_for_title("CON"), "con-note");
    }

    /// Combining vowel signs (Mn/Mc, Other_Alphabetic) must strip exactly as
    /// TS `\p{L}` does — `is_alphabetic` would keep them and split filenames
    /// between CLI and app.
    #[test]
    fn strips_combining_marks_like_the_ts_rule() {
        assert_eq!(slug_for_title("หนังสือ"), "หนงสอ");
        assert_eq!(slug_for_title("किताब"), "कतब");
    }

    #[test]
    fn collapses_separator_runs_and_trims_edges() {
        assert_eq!(slug_for_title("  A  __  B --- C  "), "a-b-c");
        assert_eq!(slug_for_title("--dashed--"), "dashed");
        assert_eq!(slug_for_title(""), "untitled");
    }

    #[test]
    fn caps_at_sixty_code_points_and_stays_idempotent() {
        let long = "word ".repeat(30);
        let slug = slug_for_title(&long);
        assert!(slug.chars().count() <= 60);
        assert!(!slug.ends_with('-'));
        assert_eq!(slug_for_title(&slug), slug);
    }
}
