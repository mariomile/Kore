//! Reflect-authored path conventions — the Rust mirror of
//! `packages/core/src/graph/paths.ts` and `vault-layout.ts`. Dailies live at
//! `daily/YYYY-MM-DD.md` unless the graph is an Obsidian vault whose
//! `.obsidian/daily-notes.json` names its own folder and format; new regular
//! notes under `notes/`; templates under `templates/`. Adopted Markdown may
//! remain anywhere eligible in the graph.

use std::path::Path;
use std::sync::OnceLock;

pub const DAILY_DIR: &str = "daily";
pub const NOTES_DIR: &str = "notes";
pub const TEMPLATES_DIR: &str = "templates";
/// Tag definition notes (TDR 0005): `tags/<name>.md` marked `lore: tag`.
pub const TAGS_DIR: &str = "tags";

/// One piece of a daily filename format: a date field or literal text.
#[derive(Debug, Clone, PartialEq, Eq)]
enum FormatPart {
    Year,
    Month { padded: bool },
    Day { padded: bool },
    Literal(String),
}

/// Where a graph keeps its daily notes: folder (`""` is the root) plus a
/// moment-style filename format, parsed. Mirrors the TS `VaultLayout` daily
/// fields; formats Kore can't round-trip fall back to the default there and
/// here alike.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DailyLayout {
    folder: String,
    parts: Vec<FormatPart>,
}

impl Default for DailyLayout {
    fn default() -> Self {
        Self {
            folder: DAILY_DIR.to_string(),
            parts: parse_daily_format("YYYY-MM-DD").unwrap_or_default(),
        }
    }
}

/// Parse a moment-style format (`YYYY`, `MM`, `M`, `DD`, `D`, `[literal]`,
/// punctuation). `None` for any other token or a missing/duplicated field.
fn parse_daily_format(format: &str) -> Option<Vec<FormatPart>> {
    let mut parts = Vec::new();
    let mut rest = format;
    while !rest.is_empty() {
        if let Some(after) = rest.strip_prefix('[') {
            let end = after.find(']')?;
            parts.push(FormatPart::Literal(after[..end].to_string()));
            rest = &after[end + 1..];
        } else if let Some(after) = rest.strip_prefix("YYYY") {
            parts.push(FormatPart::Year);
            rest = after;
        } else if let Some(after) = rest.strip_prefix("MM") {
            parts.push(FormatPart::Month { padded: true });
            rest = after;
        } else if let Some(after) = rest.strip_prefix('M') {
            parts.push(FormatPart::Month { padded: false });
            rest = after;
        } else if let Some(after) = rest.strip_prefix("DD") {
            parts.push(FormatPart::Day { padded: true });
            rest = after;
        } else if let Some(after) = rest.strip_prefix('D') {
            parts.push(FormatPart::Day { padded: false });
            rest = after;
        } else {
            let ch = rest.chars().next()?;
            if ch.is_ascii_alphabetic() {
                return None;
            }
            match parts.last_mut() {
                Some(FormatPart::Literal(text)) => text.push(ch),
                _ => parts.push(FormatPart::Literal(ch.to_string())),
            }
            rest = &rest[ch.len_utf8()..];
        }
    }
    let count = |want: fn(&FormatPart) -> bool| parts.iter().filter(|part| want(part)).count();
    let one_each = count(|part| matches!(part, FormatPart::Year)) == 1
        && count(|part| matches!(part, FormatPart::Month { .. })) == 1
        && count(|part| matches!(part, FormatPart::Day { .. })) == 1;
    one_each.then_some(parts)
}

/// A vault-relative folder, trimmed of slashes; `None` when it would escape
/// the graph or name a hidden folder.
fn normalize_folder(folder: &str) -> Option<String> {
    let trimmed = folder.trim().trim_matches('/');
    if trimmed.is_empty() {
        return Some(String::new());
    }
    let safe = !trimmed.contains('\\')
        && trimmed
            .split('/')
            .all(|segment| !segment.is_empty() && segment != ".." && !segment.starts_with('.'));
    safe.then(|| trimmed.to_string())
}

impl DailyLayout {
    /// The layout `.obsidian/daily-notes.json` declares (`folder`, `format`,
    /// Obsidian's defaults for omitted keys), or Kore's default when the file
    /// is absent, malformed, or unusable.
    pub fn from_obsidian_json(json: &str) -> Self {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(json) else {
            return Self::default();
        };
        let text = |key: &str| value.get(key).and_then(|v| v.as_str()).unwrap_or("").trim();
        let format = match text("format") {
            "" => "YYYY-MM-DD",
            format => format,
        };
        match (normalize_folder(text("folder")), parse_daily_format(format)) {
            (Some(folder), Some(parts)) if value.is_object() => {
                let layout = Self { folder, parts };
                // The format's literals can spell path segments too
                // (`[../]YYYY`); the formatted path must stay as safe as the
                // folder, or the layout is refused whole. Digits never add
                // a segment, so one sample date checks every date.
                let sample = layout.path_for("2024-01-01");
                if normalize_folder(&sample).as_deref() == Some(sample.as_str()) {
                    layout
                } else {
                    Self::default()
                }
            }
            _ => Self::default(),
        }
    }

    /// The layout for the graph at `root`.
    pub fn for_graph(root: &Path) -> Self {
        match reflect_graph_paths::read_obsidian_file(root, "daily-notes.json") {
            Some(json) => Self::from_obsidian_json(&json),
            None => Self::default(),
        }
    }

    fn format(&self, year: &str, month: &str, day: &str) -> String {
        let unpadded = |value: &str| value.trim_start_matches('0').to_string();
        let mut out = String::new();
        if !self.folder.is_empty() {
            out.push_str(&self.folder);
            out.push('/');
        }
        for part in &self.parts {
            match part {
                FormatPart::Year => out.push_str(year),
                FormatPart::Month { padded: true } => out.push_str(month),
                FormatPart::Month { padded: false } => out.push_str(&unpadded(month)),
                FormatPart::Day { padded: true } => out.push_str(day),
                FormatPart::Day { padded: false } => out.push_str(&unpadded(day)),
                FormatPart::Literal(text) => out.push_str(text),
            }
        }
        out.push_str(".md");
        out
    }

    /// Graph-relative daily path for an ISO `YYYY-MM-DD` date.
    pub fn path_for(&self, date: &str) -> String {
        let year = date.get(0..4).unwrap_or("");
        let month = date.get(5..7).unwrap_or("");
        let day = date.get(8..10).unwrap_or("");
        self.format(year, month, day)
    }

    /// The ISO date a daily path names, shape-checked only. A file that
    /// doesn't spell the date exactly as [`Self::path_for`] would is not a
    /// daily (the TS rule).
    pub fn date_from(&self, path: &str) -> Option<String> {
        let prefix = if self.folder.is_empty() {
            String::new()
        } else {
            format!("{}/", self.folder)
        };
        let mut rest = path.strip_prefix(&prefix)?.strip_suffix(".md")?;
        let (mut year, mut month, mut day) = (String::new(), String::new(), String::new());
        let take_digits = |rest: &str, max: usize| -> usize {
            rest.bytes()
                .take(max)
                .take_while(u8::is_ascii_digit)
                .count()
        };
        for part in &self.parts {
            match part {
                FormatPart::Literal(text) => rest = rest.strip_prefix(text.as_str())?,
                FormatPart::Year => {
                    if take_digits(rest, 4) != 4 {
                        return None;
                    }
                    year = rest[..4].to_string();
                    rest = &rest[4..];
                }
                FormatPart::Month { padded } | FormatPart::Day { padded } => {
                    let available = take_digits(rest, 2);
                    let width = if *padded { 2 } else { available };
                    if width == 0 || available < width {
                        return None;
                    }
                    let value = format!("{:0>2}", &rest[..width]);
                    rest = &rest[width..];
                    if matches!(part, FormatPart::Month { .. }) {
                        month = value;
                    } else {
                        day = value;
                    }
                }
            }
        }
        if !rest.is_empty() || self.format(&year, &month, &day) != path {
            return None;
        }
        Some(format!("{year}-{month}-{day}"))
    }
}

static DAILY_LAYOUT: OnceLock<DailyLayout> = OnceLock::new();

/// Adopt the daily layout of the graph at `root` for this process. The CLI
/// works on one graph per run; the first call wins.
pub fn configure_for_graph(root: &Path) {
    let _ = DAILY_LAYOUT.set(DailyLayout::for_graph(root));
}

fn daily_layout() -> &'static DailyLayout {
    DAILY_LAYOUT.get_or_init(DailyLayout::default)
}

/// Graph-relative path to the daily note for an ISO `YYYY-MM-DD` date.
pub fn daily_path(date: &str) -> String {
    daily_layout().path_for(date)
}

/// Is `value` shaped like `YYYY-MM-DD`? Shape only — calendar validity is
/// [`parse_calendar_date`]'s job (mirrors the TS split between `DAILY_PATH_RE`
/// and the calendar check).
fn is_date_shaped(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 10
        && bytes.iter().enumerate().all(|(index, byte)| match index {
            4 | 7 => *byte == b'-',
            _ => byte.is_ascii_digit(),
        })
}

/// `value` as a **real** calendar date (`2026-02-31` is rejected, matching the
/// TS resolver — an impossible date must never resolve as a daily).
pub fn parse_calendar_date(value: &str) -> Option<&str> {
    if !is_date_shaped(value) {
        return None;
    }
    value.parse::<jiff::civil::Date>().ok()?;
    Some(value)
}

/// Extract the ISO date from a daily-note path (`daily/YYYY-MM-DD.md` in
/// Kore's layout), or `None` if it isn't one. Shape-only, like the TS
/// `dateFromDailyPath`.
pub fn date_from_daily_path(path: &str) -> Option<String> {
    daily_layout().date_from(path)
}

/// Today's local date as `YYYY-MM-DD` (timezone- and DST-correct via jiff,
/// matching the desktop's date-fns local "today").
pub fn today_date() -> String {
    jiff::Zoned::now().date().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn daily_paths_round_trip() {
        assert_eq!(daily_path("2026-06-11"), "daily/2026-06-11.md");
        assert_eq!(
            date_from_daily_path("daily/2026-06-11.md").as_deref(),
            Some("2026-06-11")
        );
        assert_eq!(date_from_daily_path("notes/2026-06-11.md"), None);
        assert_eq!(date_from_daily_path("daily/nope.md"), None);
    }

    /// Parity with `paths.ts`/`resolve.ts`: shape-valid but impossible dates
    /// are not dailies.
    #[test]
    fn calendar_validation_rejects_impossible_dates() {
        assert_eq!(parse_calendar_date("2026-06-11"), Some("2026-06-11"));
        assert_eq!(parse_calendar_date("2024-02-29"), Some("2024-02-29"));
        assert_eq!(parse_calendar_date("2026-02-31"), None);
        assert_eq!(parse_calendar_date("2026-13-01"), None);
        assert_eq!(parse_calendar_date("2026-6-1"), None);
        assert_eq!(parse_calendar_date("not-a-date"), None);
    }

    #[test]
    fn obsidian_daily_layout_round_trips() {
        let layout = DailyLayout::from_obsidian_json(
            r#"{"folder":"Journal/Daily","format":"DD-MM-YYYY","template":"x"}"#,
        );
        assert_eq!(layout.path_for("2026-10-09"), "Journal/Daily/09-10-2026.md");
        assert_eq!(
            layout.date_from("Journal/Daily/09-10-2026.md").as_deref(),
            Some("2026-10-09")
        );
        assert_eq!(layout.date_from("daily/2026-10-09.md"), None);
        assert_eq!(layout.date_from("Journal/Daily/9-10-2026.md"), None);

        let unpadded = DailyLayout::from_obsidian_json(r#"{"format":"D.M.YYYY"}"#);
        assert_eq!(unpadded.path_for("2026-03-05"), "5.3.2026.md");
        assert_eq!(
            unpadded.date_from("5.3.2026.md").as_deref(),
            Some("2026-03-05")
        );
        assert_eq!(unpadded.date_from("05.03.2026.md"), None);

        assert_eq!(
            DailyLayout::from_obsidian_json(r#"{"format":"dddd"}"#),
            DailyLayout::default()
        );
        assert_eq!(
            DailyLayout::from_obsidian_json(r#"{"folder":"../x"}"#),
            DailyLayout::default()
        );
        for escaping in [
            r#"{"format":"[../../tmp/]YYYY-MM-DD"}"#,
            r#"{"format":"YYYY/../../MM/DD"}"#,
            r#"{"format":"/YYYY-MM-DD"}"#,
            r#"{"format":"[.hidden/]YYYY-MM-DD"}"#,
            r#"{"format":"YYYY\MM\DD"}"#,
        ] {
            assert_eq!(
                DailyLayout::from_obsidian_json(escaping),
                DailyLayout::default(),
                "{escaping}"
            );
        }
        let nested = DailyLayout::from_obsidian_json(r#"{"format":"YYYY/MM/DD"}"#);
        assert_eq!(nested.path_for("2026-10-09"), "2026/10/09.md");
    }

    #[test]
    fn today_is_iso_shaped() {
        assert!(parse_calendar_date(&today_date()).is_some());
    }
}
