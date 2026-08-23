-- Tag types + collections (TDR 0005).
--
-- Two new projections and one widened CHECK:
--
-- * `note_properties` — every note's non-reserved scalar (or scalar-list)
--   frontmatter keys, indexed generically so collection queries never depend
--   on any tag schema's current state.
-- * `tag_types` — the parsed schema of each tag definition note
--   (`tags/<name>.md` marked `lore: tag`), so "which tags are typed" and a
--   collection's columns are one cheap lookup instead of a frontmatter read.
-- * `notes.kind` gains 'tag' for definition notes: linkable and openable like
--   notes, excluded from note-listing surfaces like templates.
--
-- SQLite cannot widen a table-level CHECK in place, so `notes` is dropped and
-- recreated exactly like 0015: the projection is wiped rather than copied so
-- the next open re-indexes from markdown (the PROJECTION_VERSION bump forces
-- it deterministically). Wiping the children first keeps the DROP safe under
-- the app's runtime `PRAGMA foreign_keys = ON`. `index_meta` is bookkeeping
-- and the embedding tables are content-hash-keyed, so they survive; `chat_*`
-- is durable history and must never be touched.
DELETE FROM note_text;
DELETE FROM links;
DELETE FROM tags;
DELETE FROM aliases;
DELETE FROM assets;
DELETE FROM tasks;
DELETE FROM note_emails;
DELETE FROM note_claims;
DELETE FROM notes;
DELETE FROM search_fts;

DROP TABLE notes;

CREATE TABLE notes (
  path TEXT PRIMARY KEY NOT NULL,
  id TEXT,
  title TEXT NOT NULL,
  title_key TEXT NOT NULL,
  daily_date TEXT,
  is_private INTEGER NOT NULL DEFAULT 0,
  file_hash TEXT NOT NULL,
  mtime INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  pinned_order REAL,
  preview TEXT NOT NULL DEFAULT '',
  has_conflict INTEGER NOT NULL DEFAULT 0,
  gist_url TEXT,
  gist_stale INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('daily', 'note', 'template', 'tag')),
  path_key TEXT NOT NULL DEFAULT '',
  CHECK ((kind = 'daily') = (daily_date IS NOT NULL))
);

-- Recreate every index the DROP took with it (0015's seven + 0019's
-- path_key). The child tables' REFERENCES clauses and the
-- `note_keys`/`backlinks` views bind to `notes` by name, so they resolve
-- against the recreated table unchanged.
CREATE INDEX notes_title_key ON notes(title_key);
CREATE INDEX notes_daily_date ON notes(daily_date);
CREATE INDEX notes_id ON notes(id) WHERE id IS NOT NULL;
CREATE INDEX notes_daily_date_mtime_path ON notes(daily_date, mtime DESC, path);
CREATE INDEX notes_non_daily_mtime ON notes(mtime DESC, path) WHERE daily_date IS NULL;
CREATE INDEX notes_pinned ON notes(is_pinned, pinned_order, title_key, path) WHERE is_pinned = 1;
CREATE INDEX notes_has_conflict ON notes(path) WHERE has_conflict = 1;
CREATE INDEX notes_path_key ON notes(path_key);

-- Non-reserved frontmatter keys, one row per (note, key). `value` is the
-- canonical string form (JSON array text for lists); `value_number` is the
-- numeric sort key, set only for numbers. Written by the per-note
-- delete-and-reinsert like every other child projection.
CREATE TABLE note_properties (
  note_path TEXT NOT NULL REFERENCES notes(path) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  value_type TEXT NOT NULL CHECK (value_type IN ('string', 'number', 'boolean', 'list')),
  value_number REAL,
  PRIMARY KEY (note_path, key)
) WITHOUT ROWID;

-- Collection queries filter by key across notes; index that direction too.
CREATE INDEX note_properties_key ON note_properties(key, note_path);

-- The parsed schema of each tag definition note. `schema_json` is the
-- zod-validated property list as one JSON string — every writer and reader
-- goes through `encodeTagTypeJson`/`decodeTagTypeJson` (or the serde mirror).
CREATE TABLE tag_types (
  tag_key TEXT PRIMARY KEY NOT NULL,
  note_path TEXT NOT NULL REFERENCES notes(path) ON DELETE CASCADE,
  schema_json TEXT NOT NULL
) WITHOUT ROWID;

-- Definition-note deletes cascade by path; index the FK side of that join.
CREATE INDEX tag_types_note ON tag_types(note_path);
