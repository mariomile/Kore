//! `kore index` — build or refresh `.kore/index.sqlite` without the app.
//!
//! The projection is the desktop app's, not a second implementation: parsing
//! and extraction run in `@reflect/core` (the bundled `kore-indexer.mjs`,
//! executed by Node), and every row write goes through `reflect-index-store`,
//! the same crate the app's Tauri commands call. This module is the host in
//! between: it spawns Node with piped stdio and answers the core's native
//! commands (file listing, note reads, index reads and writes) over the
//! newline-delimited JSON bridge in `packages/core/src/headless/stdio-bridge.ts`.
//!
//! The first run on a graph indexes every note; later runs reconcile, reading
//! only files whose mtime moved (so `git pull && kore index` stays cheap).
//! Embeddings are not computed here: semantic vectors stay an app-side pass.

use std::io::{BufRead, Write};
use std::path::{Component, Path, PathBuf};

use reflect_index_store::query::{open_read_connection, run_query};
use reflect_index_store::scan::scan_reconcile;
use reflect_index_store::write::{
    apply_notes, clear_index, move_note_rows, remove_notes, set_index_meta,
    set_tag_type_resolutions, touch_notes, IndexedNote, MovedNoteAddress, MtimeTouch,
    TagTypeResolution,
};
use reflect_index_store::{FileMeta, StoreError};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error::CliError;

/// The script `kore index` runs, looked up next to the `kore` binary unless
/// `KORE_INDEXER` names it.
pub const INDEXER_SCRIPT: &str = "kore-indexer.mjs";

/// The only index session a headless run opens; core echoes it on writes.
const GENERATION: u64 = 1;

/// The core caps one `db_query_batch` like the desktop command does.
const DB_QUERY_BATCH_MAX: usize = 32;

/// What one run wrote, for the summary line.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStats {
    /// Notes in the graph's listing.
    pub notes: usize,
    /// Note projections (re)written.
    pub written: usize,
    /// Rows dropped because their file is gone.
    pub removed: usize,
    /// Rows moved to a renamed file (matched by frontmatter id).
    pub moved: usize,
}

/// An `AppError`-shaped failure the core can branch on by `kind`.
#[derive(Debug, Serialize)]
pub struct HostError {
    kind: &'static str,
    message: String,
}

impl HostError {
    fn io(message: impl Into<String>) -> Self {
        Self {
            kind: "io",
            message: message.into(),
        }
    }
}

impl From<StoreError> for HostError {
    fn from(err: StoreError) -> Self {
        match err {
            StoreError::Io(message) => Self {
                kind: "io",
                message,
            },
            StoreError::Parse(message) => Self {
                kind: "parse",
                message,
            },
        }
    }
}

impl From<rusqlite::Error> for HostError {
    fn from(err: rusqlite::Error) -> Self {
        Self::io(err.to_string())
    }
}

/// The native side of a headless index session over one graph.
pub struct Host {
    root: PathBuf,
    writer: Connection,
    reader: Connection,
    stats: IndexStats,
    session: Session,
}

/// What a session may do beyond indexing.
enum Session {
    /// `kore index`: reads notes and writes the index, never a note.
    Index,
    /// `kore sources`: may also write notes. Serves `request` (the CLI's flags
    /// and saved windows) to the core and keeps the `report` it sends back.
    Sources {
        request: Value,
        report: Option<Value>,
    },
}

#[derive(Deserialize)]
struct WriteArgs {
    path: String,
    contents: String,
}

#[derive(Deserialize)]
struct PathArgs {
    path: String,
}

#[derive(Deserialize)]
struct QueryArgs {
    sql: String,
    params: Vec<Value>,
}

#[derive(Deserialize)]
struct QueryBatchArgs {
    queries: Vec<QueryArgs>,
}

#[derive(Deserialize)]
struct MetaArgs {
    key: String,
    value: String,
}

#[derive(Deserialize)]
struct ApplyArgs {
    note: IndexedNote,
}

#[derive(Deserialize)]
struct ApplyBatchArgs {
    notes: Vec<IndexedNote>,
}

#[derive(Deserialize)]
struct RemoveBatchArgs {
    paths: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MoveArgs {
    from: String,
    to: String,
    to_address: MovedNoteAddress,
}

#[derive(Deserialize)]
struct TouchArgs {
    entries: Vec<MtimeTouch>,
}

#[derive(Deserialize)]
struct ResolveArgs {
    rows: Vec<TagTypeResolution>,
}

fn parse_args<T: serde::de::DeserializeOwned>(command: &str, args: &Value) -> Result<T, HostError> {
    serde_json::from_value(args.clone()).map_err(|err| HostError {
        kind: "parse",
        message: format!("bad arguments for \"{command}\": {err}"),
    })
}

impl Host {
    /// Open (creating and migrating as needed) the graph's index for writing,
    /// plus a guarded read-only connection for the core's queries.
    pub fn open(root: &Path) -> Result<Self, CliError> {
        let writer = reflect_index_schema::open_index_at(root)
            .map_err(|err| CliError::runtime(format!("could not open the index: {err}")))?;
        let reader = open_read_connection(root)
            .map_err(|err| CliError::runtime(format!("could not open the index: {err}")))?;
        Ok(Self {
            root: root.to_path_buf(),
            writer,
            reader,
            stats: IndexStats::default(),
            session: Session::Index,
        })
    }

    /// Make this a `kore sources` session: it may write notes, and serves
    /// `request` to the core.
    pub fn with_sources(mut self, request: Value) -> Self {
        self.session = Session::Sources {
            request,
            report: None,
        };
        self
    }

    /// What the core's source run reported back, if it got that far.
    pub fn take_report(&mut self) -> Option<Value> {
        match &mut self.session {
            Session::Sources { report, .. } => report.take(),
            Session::Index => None,
        }
    }

    /// What this session has written so far.
    pub fn stats(&self) -> &IndexStats {
        &self.stats
    }

    /// Answer one bridge command with its JSON result.
    pub fn handle(&mut self, command: &str, args: &Value) -> Result<Value, HostError> {
        match command {
            "index_open" => Ok(json!(GENERATION)),
            "list_files" => {
                let notes: Vec<FileMeta> = self.note_files();
                self.stats.notes = notes.len();
                Ok(serde_json::to_value(notes).map_err(|err| HostError::io(err.to_string()))?)
            }
            "note_read" => {
                let PathArgs { path } = parse_args(command, args)?;
                Ok(json!(self.read_note(&path)?))
            }
            "note_read_local" => {
                let PathArgs { path } = parse_args(command, args)?;
                Ok(json!({ "kind": "content", "content": self.read_note(&path)? }))
            }
            "db_query" => {
                let QueryArgs { sql, params } = parse_args(command, args)?;
                Ok(json!(run_query(&self.reader, &sql, &params)?))
            }
            "db_query_batch" => {
                let QueryBatchArgs { queries } = parse_args(command, args)?;
                if queries.len() > DB_QUERY_BATCH_MAX {
                    return Err(HostError {
                        kind: "parse",
                        message: format!(
                            "db_query_batch is capped at {DB_QUERY_BATCH_MAX} queries"
                        ),
                    });
                }
                let mut out = Vec::with_capacity(queries.len());
                for query in &queries {
                    out.push(run_query(&self.reader, &query.sql, &query.params)?);
                }
                Ok(json!(out))
            }
            "index_meta_set" => {
                let MetaArgs { key, value } = parse_args(command, args)?;
                set_index_meta(&self.writer, &key, &value)?;
                Ok(Value::Null)
            }
            "index_clear" => {
                clear_index(&self.writer)?;
                Ok(Value::Null)
            }
            "index_apply" => {
                let ApplyArgs { note } = parse_args(command, args)?;
                apply_notes(&mut self.writer, std::slice::from_ref(&note))?;
                self.stats.written += 1;
                Ok(Value::Null)
            }
            "index_apply_batch" => {
                let ApplyBatchArgs { notes } = parse_args(command, args)?;
                apply_notes(&mut self.writer, &notes)?;
                self.stats.written += notes.len();
                Ok(Value::Null)
            }
            "index_remove_batch" => {
                let RemoveBatchArgs { paths } = parse_args(command, args)?;
                remove_notes(&mut self.writer, &paths)?;
                self.stats.removed += paths.len();
                Ok(Value::Null)
            }
            "index_move" => {
                let MoveArgs {
                    from,
                    to,
                    to_address,
                } = parse_args(command, args)?;
                move_note_rows(&mut self.writer, &from, &to, &to_address)?;
                self.stats.moved += 1;
                Ok(Value::Null)
            }
            "index_touch" => {
                let TouchArgs { entries } = parse_args(command, args)?;
                touch_notes(&mut self.writer, &entries)?;
                Ok(Value::Null)
            }
            "index_tag_types_resolve" => {
                let ResolveArgs { rows } = parse_args(command, args)?;
                set_tag_type_resolutions(&mut self.writer, &rows)?;
                Ok(Value::Null)
            }
            "index_reconcile_scan" => {
                let files = self.note_files();
                self.stats.notes = files.len();
                let now_ms = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|elapsed| elapsed.as_millis() as u64)
                    .unwrap_or(0);
                let scan = scan_reconcile(&self.writer, &files, now_ms)?;
                Ok(serde_json::to_value(scan).map_err(|err| HostError::io(err.to_string()))?)
            }
            "sources_config" => match &self.session {
                Session::Sources { request, .. } => Ok(request.clone()),
                Session::Index => Err(HostError::io("this session runs no sources")),
            },
            "sources_report" => match &mut self.session {
                Session::Sources { report, .. } => {
                    *report = Some(args.clone());
                    Ok(Value::Null)
                }
                Session::Index => Err(HostError::io("this session runs no sources")),
            },
            "note_create" => {
                let WriteArgs { path, contents } = parse_args(command, args)?;
                let absolute = self.writable_note(&path)?;
                match crate::write::atomic_create(&absolute, &contents) {
                    Ok(()) => {
                        Ok(json!({ "kind": "created", "modifiedMs": modified_ms(&absolute) }))
                    }
                    Err(crate::write::CreateError::Exists) => Ok(json!({ "kind": "collision" })),
                    Err(crate::write::CreateError::Other(err)) => {
                        Err(HostError::io(err.to_string()))
                    }
                }
            }
            "note_write" => {
                let WriteArgs { path, contents } = parse_args(command, args)?;
                let absolute = self.writable_note(&path)?;
                crate::write::atomic_write(&absolute, &contents)
                    .map_err(|err| HostError::io(err.to_string()))?;
                Ok(json!(modified_ms(&absolute)))
            }
            other => Err(HostError::io(format!(
                "kore index does not serve \"{other}\""
            ))),
        }
    }

    fn note_files(&self) -> Vec<FileMeta> {
        reflect_graph_paths::walk_catalog(&self.root)
            .notes
            .into_iter()
            .map(FileMeta::from)
            .collect()
    }

    /// Resolve a note path the core wants to write. Only a `kore sources`
    /// session writes, and only eligible, symlink-free note paths.
    fn writable_note(&self, path: &str) -> Result<PathBuf, HostError> {
        if matches!(self.session, Session::Index) {
            return Err(HostError::io("kore index never writes notes"));
        }
        crate::note_file::checked_note_path(&self.root, path).map_err(|err| HostError {
            kind: "traversal",
            message: err.to_string(),
        })
    }

    /// Read a graph-relative markdown file. Paths come from the core, which
    /// got them from this host's listing; anything that escapes the graph, or
    /// runs through a symlink at any depth, is refused like the desktop's
    /// `note_read` does.
    fn read_note(&self, path: &str) -> Result<String, HostError> {
        let relative = Path::new(path);
        let escapes = relative
            .components()
            .any(|part| !matches!(part, Component::Normal(_)));
        if path.is_empty() || escapes || !path.ends_with(".md") {
            return Err(HostError {
                kind: "traversal",
                message: format!("not a graph note path: {path}"),
            });
        }
        let not_found = || HostError {
            kind: "notFound",
            message: format!("no such note: {path}"),
        };
        let absolute = match crate::note_file::symlink_free_path(&self.root, path) {
            Ok(Some(absolute)) => absolute,
            Ok(None) => {
                return Err(HostError {
                    kind: "traversal",
                    message: format!("refusing to follow a symlink: {path}"),
                })
            }
            Err(err) => return Err(HostError::io(format!("{path}: {err}"))),
        };
        std::fs::read_to_string(&absolute).map_err(|err| match err.kind() {
            std::io::ErrorKind::NotFound => not_found(),
            _ => HostError::io(format!("{path}: {err}")),
        })
    }
}

fn modified_ms(path: &Path) -> Option<u64> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    let elapsed = modified.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some(elapsed.as_millis() as u64)
}

#[derive(Deserialize)]
struct Request {
    id: u64,
    command: String,
    #[serde(default)]
    args: Value,
}

/// Serve bridge requests from `requests` until it closes, writing one reply
/// line per request to `replies`.
pub fn serve(
    host: &mut Host,
    requests: impl BufRead,
    mut replies: impl Write,
) -> Result<(), CliError> {
    for line in requests.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let request: Request = serde_json::from_str(&line)
            .map_err(|err| CliError::runtime(format!("malformed indexer request: {err}")))?;
        let reply = match host.handle(&request.command, &request.args) {
            Ok(value) => json!({ "id": request.id, "ok": value }),
            Err(error) => json!({ "id": request.id, "error": error }),
        };
        // A closed pipe means the indexer exited; its exit status says why.
        if writeln!(replies, "{reply}")
            .and_then(|()| replies.flush())
            .is_err()
        {
            break;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(path: &str, text: &str) -> Value {
        json!({
            "path": path, "id": null, "title": "Kore", "titleKey": "kore",
            "pathKey": path, "kind": "note", "dailyDate": null, "isPrivate": false,
            "isPinned": false, "pinnedOrder": null, "hasConflict": false,
            "gistUrl": null, "gistStale": false, "fileHash": "h1", "mtime": 1,
            "text": text, "assetText": "", "preview": text, "links": [], "tags": [],
            "aliases": [], "claims": [], "emails": [], "assets": [], "tasks": [],
            "properties": [], "propertiesText": "", "tagType": null
        })
    }

    #[test]
    fn serves_a_write_then_reads_it_back_through_the_bridge() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("notes")).unwrap();
        std::fs::write(dir.path().join("notes/kore.md"), "# Kore\n").unwrap();
        let mut host = Host::open(dir.path()).unwrap();
        let requests = [
            json!({ "id": 1, "command": "index_open", "args": {} }),
            json!({ "id": 2, "command": "note_read", "args": { "path": "notes/kore.md" } }),
            json!({ "id": 3, "command": "index_apply_batch",
                    "args": { "generation": 1, "notes": [note("notes/kore.md", "headless")] } }),
            json!({ "id": 4, "command": "db_query",
                    "args": { "sql": "SELECT path FROM notes", "params": [] } }),
        ]
        .map(|request| request.to_string())
        .join("\n");
        let mut replies = Vec::new();
        serve(&mut host, requests.as_bytes(), &mut replies).unwrap();
        let replies: Vec<Value> = String::from_utf8(replies)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(replies[0], json!({ "id": 1, "ok": 1 }));
        assert_eq!(replies[1], json!({ "id": 2, "ok": "# Kore\n" }));
        assert_eq!(replies[2], json!({ "id": 3, "ok": null }));
        assert_eq!(
            replies[3],
            json!({ "id": 4, "ok": [{ "path": "notes/kore.md" }] })
        );
        assert_eq!(host.stats().written, 1);
    }

    #[test]
    fn writes_notes_only_in_a_sources_session_and_never_clobbers() {
        let dir = tempfile::tempdir().unwrap();
        let args = json!({ "path": "Readwise/Books/A.md", "contents": "one\n", "generation": 1 });
        let mut index = Host::open(dir.path()).unwrap();
        assert!(index.handle("note_create", &args).is_err());

        let mut host = Host::open(dir.path())
            .unwrap()
            .with_sources(json!({ "only": null, "since": null, "state": {} }));
        let created = host.handle("note_create", &args).unwrap();
        assert_eq!(created["kind"], "created");
        let again = host
            .handle(
                "note_create",
                &json!({ "path": "Readwise/Books/A.md", "contents": "two\n" }),
            )
            .unwrap();
        assert_eq!(again["kind"], "collision");
        host.handle(
            "note_write",
            &json!({ "path": "Readwise/Books/A.md", "contents": "three\n" }),
        )
        .unwrap();
        let read = host
            .handle("note_read", &json!({ "path": "Readwise/Books/A.md" }))
            .unwrap();
        assert_eq!(read, json!("three\n"));
        let escape = host
            .handle("note_write", &json!({ "path": "../x.md", "contents": "" }))
            .unwrap_err();
        assert_eq!(escape.kind, "traversal");
    }

    #[test]
    fn refuses_reads_outside_the_graph_and_names_missing_notes() {
        let dir = tempfile::tempdir().unwrap();
        let mut host = Host::open(dir.path()).unwrap();
        let escape = host
            .handle("note_read", &json!({ "path": "../secret.md" }))
            .unwrap_err();
        assert_eq!(escape.kind, "traversal");
        let missing = host
            .handle("note_read", &json!({ "path": "notes/gone.md" }))
            .unwrap_err();
        assert_eq!(missing.kind, "notFound");
        let write = host
            .handle(
                "db_query",
                &json!({ "sql": "DELETE FROM notes", "params": [] }),
            )
            .unwrap_err();
        assert_eq!(write.kind, "io");
    }

    #[cfg(unix)]
    #[test]
    fn refuses_reads_through_a_symlinked_directory() {
        let outside = tempfile::tempdir().unwrap();
        std::fs::create_dir(outside.path().join("assets")).unwrap();
        std::fs::write(outside.path().join("assets/photo.png.kore.md"), "secret").unwrap();
        let dir = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), dir.path().join("linked")).unwrap();
        let mut host = Host::open(dir.path()).unwrap();
        let linked = host
            .handle(
                "note_read_local",
                &json!({ "path": "linked/assets/photo.png.kore.md" }),
            )
            .unwrap_err();
        assert_eq!(linked.kind, "traversal");
    }
}
