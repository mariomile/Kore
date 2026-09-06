//! `reflect` — read/discovery/write CLI over a Kore graph (Plan 14, agent
//! parity per Plan 30).
//!
//! Self-contained: reads the graph's markdown files directly and opens
//! `.reflect/index.sqlite` strictly read-only — no Node runtime, no running
//! desktop app, no IPC. The modules mirror the small contract owned by
//! `@reflect/core` (paths, fold keys, frontmatter, title derivation, slugs,
//! hashing, FTS match syntax, the tag grammar, property typing); each one
//! names its TS counterpart and is parity- or unit-tested against the same
//! rules. Keep this surface tight — the CLI must never grow its own parser
//! or indexer beyond it, and its writes stay **structural**: each one
//! changes exactly the bytes it is about (`capture`/`append` add, `new`
//! claims a file atomically, `set` splices one frontmatter key, `tag`/`untag`
//! one trailing line, `done` one task marker) and nothing overwrites a note.
//! In-place prose edits belong to markdown editing, which the desktop app
//! picks up live.
//!
//! Privacy contract: notes with `private: true` frontmatter are invisible
//! through this CLI — excluded from every index-backed listing, refused by
//! every reading and writing command — with no override flag. The resolved
//! file's own frontmatter is checked, never just the index row, so a stale
//! index can't leak a just-flagged note.

pub mod body_tag;
pub mod commands;
pub mod error;
pub mod frontmatter_values;
pub mod frontmatter_write;
pub mod graph;
pub mod hash;
pub mod index;
pub mod keys;
pub mod note_file;
pub mod paths;
pub mod resolve;
pub mod schema;
pub mod search;
pub mod slug;
pub mod write;
