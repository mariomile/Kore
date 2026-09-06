//! Shared fixtures for the `reflect` integration tests: a temp graph on
//! disk, an index built with the shared `reflect-index-schema` migrations
//! plus direct row inserts that mirror the desktop's `apply_note` write path
//! (`apps/desktop/src-tauri/src/db/write.rs`), and the process helpers that
//! run the real binary. Each test binary uses a subset, hence `dead_code`.
#![allow(dead_code)]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use rusqlite::params;
use tempfile::TempDir;

use reflect_cli::hash::hash_content;
use reflect_cli::keys::fold_key;
use reflect_cli::note_file::parse_note_meta;

/// `note_claims.tier` values (the desktop's `claim_tier`): lower wins.
const TIER_DAILY_DATE: i64 = 1;
const TIER_TITLE: i64 = 2;
const TIER_ALIAS: i64 = 3;
const TIER_BASENAME: i64 = 4;

pub struct Fixture {
    pub dir: TempDir,
}

impl Fixture {
    pub fn root(&self) -> &Path {
        self.dir.path()
    }

    pub fn write_note(&self, rel_path: &str, content: &str) -> PathBuf {
        let absolute = self.root().join(rel_path);
        fs::create_dir_all(absolute.parent().unwrap()).unwrap();
        fs::write(&absolute, content).unwrap();
        absolute
    }

    /// Index every note on disk the way the desktop pipeline would: derived
    /// title/aliases/private, content hash, file mtime, FTS row.
    pub fn build_index(&self) {
        let conn = reflect_index_schema::open_index_at(self.root()).unwrap();
        for note in reflect_cli::note_file::walk_notes(self.root()) {
            let content = fs::read_to_string(self.root().join(&note.rel_path)).unwrap();
            let meta = parse_note_meta(&note.rel_path, &content);
            let daily_date = reflect_cli::paths::date_from_daily_path(&note.rel_path);
            let kind = if daily_date.is_some() {
                "daily"
            } else {
                "note"
            };
            conn.execute(
                "INSERT INTO notes(path, id, title, title_key, kind, daily_date, is_private,
                                   is_pinned, pinned_order, file_hash, mtime, updated_at, preview)
                 VALUES(?1, ?8, ?2, ?3, ?9, ?4, ?5, 0, NULL, ?6, ?7, ?7, '')",
                params![
                    note.rel_path,
                    meta.title,
                    fold_key(&meta.title),
                    daily_date,
                    i64::from(meta.private),
                    hash_content(&content),
                    note.mtime_ms as i64,
                    meta.id,
                    kind,
                ],
            )
            .unwrap();
            for alias in &meta.aliases {
                conn.execute(
                    "INSERT INTO aliases(note_path, alias, alias_key) VALUES(?1, ?2, ?3)",
                    params![note.rel_path, alias, fold_key(alias)],
                )
                .unwrap();
            }
            // The spellings this note answers to, mirroring the desktop's
            // `projectNoteClaims`: date, title, aliases, filename stem, first
            // claim of a key wins.
            let stem = {
                let filename = note.rel_path.rsplit('/').next().unwrap_or(&note.rel_path);
                filename.strip_suffix(".md").unwrap_or(filename)
            };
            let mut claims: Vec<(String, i64)> = Vec::new();
            let claim = |claims: &mut Vec<(String, i64)>, key: String, tier: i64| {
                if !key.is_empty() && !claims.iter().any(|(existing, _)| *existing == key) {
                    claims.push((key, tier));
                }
            };
            if let Some(date) = daily_date {
                // Calendar-valid only: an impossible `daily/2026-02-31.md` is
                // an ordinary note and must never claim a date.
                if reflect_cli::paths::parse_calendar_date(date).is_some() {
                    claim(&mut claims, date.to_string(), TIER_DAILY_DATE);
                }
            }
            claim(&mut claims, fold_key(&meta.title), TIER_TITLE);
            for alias in &meta.aliases {
                claim(&mut claims, fold_key(alias), TIER_ALIAS);
            }
            claim(&mut claims, fold_key(stem), TIER_BASENAME);
            for (key, tier) in &claims {
                conn.execute(
                    "INSERT INTO note_claims(note_path, key, tier) VALUES(?1, ?2, ?3)",
                    params![note.rel_path, key, tier],
                )
                .unwrap();
            }
            conn.execute(
                "INSERT INTO search_fts(path, title, body) VALUES(?1, ?2, ?3)",
                params![note.rel_path, meta.title, content],
            )
            .unwrap();
        }
    }
}

pub fn graph() -> Fixture {
    let dir = TempDir::new().unwrap();
    for sub in [".reflect", "daily", "notes"] {
        fs::create_dir_all(dir.path().join(sub)).unwrap();
    }
    Fixture { dir }
}

pub fn reflect(fixture: &Fixture, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_reflect"))
        .args(args)
        .current_dir(fixture.root())
        .env_remove("REFLECT_GRAPH")
        .output()
        .unwrap()
}

pub fn stdout(output: &Output) -> String {
    String::from_utf8(output.stdout.clone()).unwrap()
}

pub fn stderr(output: &Output) -> String {
    String::from_utf8(output.stderr.clone()).unwrap()
}

pub fn json(output: &Output) -> serde_json::Value {
    serde_json::from_str(&stdout(output)).unwrap()
}

impl Fixture {
    /// Insert one task row the way the desktop projection would.
    pub fn insert_task(
        &self,
        rel_path: &str,
        offset: i64,
        text: &str,
        checked: bool,
        due: Option<&str>,
        due_time: Option<&str>,
    ) {
        let conn =
            rusqlite::Connection::open(self.root().join(".reflect").join("index.sqlite")).unwrap();
        conn.execute(
            "INSERT INTO tasks(note_path, marker_offset, text, raw, checked, due_date, due_time)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                rel_path,
                offset,
                text,
                format!("[ ] {text}"),
                i64::from(checked),
                due,
                due_time
            ],
        )
        .unwrap();
    }
}

impl Fixture {
    /// Insert one wiki link the way the desktop projection would.
    pub fn insert_wiki_link(&self, source: &str, target_title: &str, pos: i64) {
        let conn =
            rusqlite::Connection::open(self.root().join(".reflect").join("index.sqlite")).unwrap();
        conn.execute(
            "INSERT INTO links(source_path, kind, target_raw, target_key, alias,
                               pos_from, pos_to, target_path_key)
             VALUES(?1, 'wiki', ?2, ?3, NULL, ?4, ?4, NULL)",
            params![source, target_title, fold_key(target_title), pos],
        )
        .unwrap();
    }
}

impl Fixture {
    pub fn index_conn(&self) -> rusqlite::Connection {
        rusqlite::Connection::open(self.root().join(".reflect").join("index.sqlite")).unwrap()
    }

    /// Mirror the desktop's tag projection: one row per tag occurrence.
    pub fn insert_tag(&self, rel_path: &str, tag: &str) {
        self.index_conn()
            .execute(
                "INSERT INTO tags(note_path, tag, tag_key) VALUES(?1, ?2, ?3)",
                params![rel_path, tag, tag.to_lowercase()],
            )
            .unwrap();
    }

    /// A typed tag: its definition note row plus the `tag_types` schema.
    pub fn insert_tag_type(&self, tag: &str, schema_json: &str) {
        let conn = self.index_conn();
        let path = format!("tags/{tag}.md");
        conn.execute(
            "INSERT OR IGNORE INTO notes(path, id, title, title_key, kind, is_private, is_pinned,
                                         file_hash, mtime, updated_at, preview)
             VALUES(?1, ?2, ?3, ?3, 'tag', 0, 0, 'x', 0, 0, '')",
            params![path, format!("tag-{tag}"), tag],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tag_types(tag_key, note_path, schema_json) VALUES(?1, ?2, ?3)",
            params![tag.to_lowercase(), path, schema_json],
        )
        .unwrap();
    }

    pub fn set_updated(&self, rel_path: &str, updated_ms: i64) {
        self.index_conn()
            .execute(
                "UPDATE notes SET updated_at = ?2 WHERE path = ?1",
                params![rel_path, updated_ms],
            )
            .unwrap();
    }
}

pub fn reflect_stdin(fixture: &Fixture, args: &[&str], input: &str) -> Output {
    use std::io::Write;
    let mut child = Command::new(env!("CARGO_BIN_EXE_reflect"))
        .args(args)
        .current_dir(fixture.root())
        .env_remove("REFLECT_GRAPH")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(input.as_bytes())
        .unwrap();
    child.wait_with_output().unwrap()
}

pub fn read(fixture: &Fixture, rel_path: &str) -> String {
    fs::read_to_string(fixture.root().join(rel_path)).unwrap()
}

pub const BOOK_SCHEMA: &str = r#"[
  {"name":"Author","key":"author","type":"relation","target":"person"},
  {"name":"Rating","key":"rating","type":"rating"},
  {"name":"Read","key":"read","type":"checkbox"},
  {"name":"Read on","key":"read-on","type":"date"},
  {"name":"Genres","key":"genres","type":"multiselect","options":["scifi","classic"]},
  {"name":"Added","key":"added","type":"created"},
  {"name":"Pages","key":"pages","type":"rollup","rollup":{"relation":"author","property":"x","aggregation":"count"}}
]"#;
