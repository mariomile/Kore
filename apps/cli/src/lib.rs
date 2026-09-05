//! `reflect` — read/discovery/capture CLI over a Kore graph (Plan 14).
//!
//! Self-contained: reads the graph's markdown files directly and opens
//! `.reflect/index.sqlite` strictly read-only — no Node runtime, no running
//! desktop app, no IPC. The modules mirror the small contract owned by
//! `@reflect/core` (paths, fold keys, frontmatter, title derivation, slugs,
//! hashing, FTS match syntax); each one names its TS counterpart and is
//! parity-tested against the same expected values. Keep this surface tight —
//! the CLI must never grow its own parser or indexer beyond it, and its only
//! writes stay structural: `capture` (an append-only list item) and `new`
//! (an atomic no-clobber note create). In-place edits belong to markdown
//! editing, which the desktop app picks up live.
//!
//! Privacy contract: notes with `private: true` frontmatter are invisible
//! through this CLI — excluded from `search`/`tasks`/`backlinks`/`recent`,
//! refused by `show`/`today`/`path`/`open`/`capture` — with no override flag.
//! The resolved file's own frontmatter is checked, never just the index row,
//! so a stale index can't leak a just-flagged note.

pub mod commands;
pub mod error;
pub mod frontmatter_values;
pub mod graph;
pub mod hash;
pub mod index;
pub mod keys;
pub mod note_file;
pub mod paths;
pub mod resolve;
pub mod search;
pub mod slug;
