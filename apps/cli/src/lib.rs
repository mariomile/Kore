//! `kore` — read/discovery/write CLI over a Kore graph (Plan 14, agent
//! parity per Plan 30).
//!
//! Self-contained: reads the graph's markdown files directly and opens
//! `.kore/index.sqlite` strictly read-only — no Node runtime, no running
//! desktop app, no IPC. The one exception is `kore index` ([`indexer`]),
//! which builds the index without the app by running `@reflect/core`'s own
//! indexer under Node and writing its rows through `reflect-index-store`. The modules mirror the small contract owned by
//! `@reflect/core` (paths, fold keys, frontmatter, title derivation, slugs,
//! hashing, FTS match syntax, the tag grammar, property typing); each one
//! names its TS counterpart and is parity- or unit-tested against the same
//! rules. Keep this surface tight — the CLI must never grow its own parser
//! or indexer beyond it (`kore index` hosts the core's, it does not copy it), and its writes stay **structural**: each one
//! changes exactly the bytes it is about (`capture`/`append` add, `new`
//! claims a file atomically, `set` splices one frontmatter key, `tag`/`untag`
//! one trailing line, `done` one task marker, `edit` one passage it was told
//! the exact current text of) and nothing overwrites a note.
//!
//! Privacy contract: notes with `private: true` frontmatter are invisible
//! through this CLI — excluded from every index-backed listing, refused by
//! every reading and writing command — with no override flag. The resolved
//! file's own frontmatter is checked, never just the index row, so a stale
//! index can't leak a just-flagged note.

pub mod agent_identity;
pub mod agent_keys;
pub mod body_tag;
pub mod commands;
pub mod embed;
pub mod error;
pub mod frontmatter_values;
pub mod frontmatter_write;
pub mod graph;
pub mod hash;
pub mod index;
pub mod indexer;
pub mod keys;
pub mod library;
pub mod mcp;
pub mod mcp_http;
pub mod note_file;
pub mod paths;
pub mod resolve;
pub mod schema;
pub mod search;
pub mod search_query;
pub mod semantic;
pub mod slug;
pub mod vault_sync;
pub mod write;
