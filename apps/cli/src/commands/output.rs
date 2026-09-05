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
    /// Local `HH:MM` on `due_date` when the item carries `@HH:MM`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due_time: Option<String>,
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

/// `collection`: a typed tag's rows plus its schema and the staleness signal.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionJson<'a> {
    pub tag: &'a str,
    /// True when files on disk diverge from the index — rows may be stale.
    pub stale: bool,
    /// The tag's schema — one entry per property column.
    pub schema: Vec<PropertyJson<'a>>,
    pub notes: Vec<CollectionNoteJson>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PropertyJson<'a> {
    pub name: &'a str,
    pub key: &'a str,
    #[serde(rename = "type")]
    pub kind: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionNoteJson {
    pub path: String,
    pub title: String,
    /// Frontmatter property values, keyed by frontmatter key (typed JSON).
    pub properties: serde_json::Map<String, serde_json::Value>,
}

/// `new`: the created note.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewJson<'a> {
    pub path: &'a str,
    pub absolute_path: String,
    pub title: &'a str,
    /// The `--tag`s written as trailing `#tag` lines.
    pub tags: &'a [String],
    /// The frontmatter values written (`--set` plus `created` stamps).
    pub properties: serde_json::Map<String, serde_json::Value>,
}

/// `set`: the frontmatter keys written and removed.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetJson<'a> {
    pub path: &'a str,
    pub absolute_path: String,
    /// The values as written (typed JSON).
    pub set: serde_json::Map<String, serde_json::Value>,
    pub unset: &'a [String],
}

/// `tag`: whether the trailing tag line was added.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagWriteJson<'a> {
    pub path: &'a str,
    pub tag: &'a str,
    /// False when the body already carried the tag.
    pub added: bool,
    /// `created` stamps written because the tag is typed.
    pub stamped: serde_json::Map<String, serde_json::Value>,
}

/// `untag`: whether a trailing tag line was removed.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UntagJson<'a> {
    pub path: &'a str,
    pub tag: &'a str,
    pub removed: bool,
}

/// `done`: the task whose marker was toggled.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoneJson<'a> {
    pub path: &'a str,
    pub text: &'a str,
    pub checked: bool,
}

/// `append`: where the block landed.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendJson<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date: Option<&'a str>,
    pub path: &'a str,
    pub absolute_path: String,
    /// True when this append created the daily note.
    pub created: bool,
    pub bytes_appended: usize,
}

/// `info`: the graph and its index at a glance (works without an index).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InfoJson {
    pub root: String,
    pub cli_version: &'static str,
    pub index: IndexInfoJson,
    /// Null when the index is absent or unusable.
    pub counts: Option<CountsJson>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexInfoJson {
    pub present: bool,
    pub usable: bool,
    pub newer_schema: bool,
    pub stale: bool,
    pub stale_files: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CountsJson {
    pub notes: i64,
    pub dailies: i64,
    pub tags: i64,
}

/// `tags`: every tag with its public note count and whether it is typed.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagsJson {
    pub stale: bool,
    pub tags: Vec<TagJson>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagJson {
    pub tag: String,
    pub count: i64,
    /// True when `tags/<tag>.md` declares a schema (a collection).
    pub typed: bool,
    /// The definition note's path when the tag is typed.
    pub definition: Option<String>,
}

/// `list`: notes newest first, with their tags.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListJson {
    pub stale: bool,
    pub notes: Vec<ListNoteJson>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListNoteJson {
    pub path: String,
    pub title: String,
    /// `daily` or `note`.
    pub kind: String,
    /// RFC 3339 UTC timestamp of the last indexed update.
    pub updated_at: String,
    pub tags: Vec<String>,
}

/// `properties`: a note's frontmatter as typed property values.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PropertiesJson<'a> {
    pub path: &'a str,
    pub title: &'a str,
    pub aliases: &'a [String],
    pub pinned: bool,
    /// From the index when it is open; empty otherwise.
    pub tags: Vec<String>,
    pub properties: serde_json::Map<String, serde_json::Value>,
}

/// `links`: the wiki links a note makes, resolved when a target exists.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinksJson<'a> {
    pub path: &'a str,
    pub stale: bool,
    pub links: Vec<LinkJson>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkJson {
    /// The link's target text as written (`[[target]]`).
    pub target: String,
    /// The resolved note's path, or null when no note answers to the target.
    pub path: Option<String>,
    pub title: Option<String>,
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
