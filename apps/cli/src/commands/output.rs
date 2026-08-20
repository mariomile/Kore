//! The `--json` output contracts (documented in `docs/cli.md`, locked by the
//! integration tests) plus the human print helpers. Field names are camelCase
//! to match the rest of Reflect's external JSON shapes.

use serde::Serialize;

use crate::error::CliError;

/// `today` / `show`: the note itself.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteJson<'a> {
    /// The daily date, when the note is a daily.
    pub date: Option<&'a str>,
    pub path: &'a str,
    pub absolute_path: String,
    pub title: &'a str,
    pub content: &'a str,
}

/// `path` / `today --path`: a resolved location (the file may not exist yet
/// for dailies — they are created lazily on first write).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathJson<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date: Option<&'a str>,
    pub path: &'a str,
    pub absolute_path: String,
    pub exists: bool,
}

/// `open`: the deep link handed to the OS opener (or just printed).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenJson<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date: Option<&'a str>,
    pub path: &'a str,
    /// The `reflect://` URL (docs/deep-links.md).
    pub url: &'a str,
    /// False under `--print` — the URL was emitted, not handed to the OS.
    pub launched: bool,
}

/// `search`: the ranked hits plus the staleness signal.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchJson<'a> {
    pub query: &'a str,
    /// True when files on disk diverge from the index — results may be stale.
    pub stale: bool,
    pub results: Vec<HitJson>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HitJson {
    pub path: String,
    pub title: String,
    pub snippet: String,
    /// bm25 rank (more negative = better match); `0` for title-only substring hits.
    pub score: f64,
}

/// `tasks`: the graph's tasks plus the staleness signal.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TasksJson {
    /// True when files on disk diverge from the index — tasks may be stale.
    pub stale: bool,
    pub tasks: Vec<TaskJson>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskJson {
    /// Graph-relative path of the note the task lives in.
    pub path: String,
    pub title: String,
    /// The task's text, without its checkbox marker.
    pub text: String,
    pub checked: bool,
    /// The first calendar-valid `[[YYYY-MM-DD]]` link inside the item.
    pub due_date: Option<String>,
}

/// `capture`: where the item landed.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureJson<'a> {
    /// The daily date, when the target is a daily note.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date: Option<&'a str>,
    pub path: &'a str,
    pub absolute_path: String,
    /// True when this capture created the daily note.
    pub created: bool,
    /// The exact line appended, marker included (e.g. `+ [ ] Pay bill`).
    pub item: &'a str,
}

/// `backlinks`: the notes linking to the resolved target.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BacklinksJson<'a> {
    /// The resolved target's graph-relative path.
    pub path: &'a str,
    pub title: &'a str,
    /// True when files on disk diverge from the index — rows may be stale.
    pub stale: bool,
    pub backlinks: Vec<BacklinkJson>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BacklinkJson {
    /// Graph-relative path of the linking note.
    pub path: String,
    pub title: String,
    /// How many links this note carries to the target.
    pub count: i64,
}

/// `recent`: the most recently updated notes, newest first.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentJson {
    /// True when files on disk diverge from the index — rows may be stale.
    pub stale: bool,
    pub notes: Vec<RecentNoteJson>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentNoteJson {
    pub path: String,
    pub title: String,
    /// RFC 3339 UTC timestamp of the last indexed update.
    pub updated_at: String,
}

/// `new`: the created note.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewJson<'a> {
    pub path: &'a str,
    pub absolute_path: String,
    pub title: &'a str,
}

pub fn print_json<T: Serialize>(value: &T) -> Result<(), CliError> {
    let json = serde_json::to_string_pretty(value)
        .map_err(|err| CliError::Runtime(format!("could not serialize output: {err}")))?;
    println!("{json}");
    Ok(())
}

/// Print raw note content, normalizing to exactly one trailing newline.
pub fn print_content(content: &str) {
    if content.ends_with('\n') {
        print!("{content}");
    } else {
        println!("{content}");
    }
}
