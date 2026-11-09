/**
 * Kore Cloud's D1 schema. One row per note, keyed by its graph-relative path,
 * holding the full Markdown source plus what search needs. `version` counts
 * writes to that note (compare-and-swap); `seq` orders every write across the
 * vault, so a client pulls what changed after the last `seq` it saw. A deleted
 * note stays as an empty tombstone so the deletion can be pulled too.
 *
 * `id` is an explicit INTEGER PRIMARY KEY because the FTS index points at it:
 * an implicit rowid may be renumbered by VACUUM, which would silently detach
 * the index from its rows.
 *
 * Statements are idempotent: the Worker runs them once per isolate, so a
 * fresh database and an upgraded one both converge on this shape.
 */
export const SCHEMA: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL,
    title TEXT NOT NULL,
    tags TEXT NOT NULL,
    text TEXT NOT NULL,
    daily TEXT,
    version INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS notes_seq ON notes(seq)`,
  `CREATE INDEX IF NOT EXISTS notes_updated ON notes(deleted, updated_at)`,
  `CREATE INDEX IF NOT EXISTS notes_title ON notes(title COLLATE NOCASE)`,
  `CREATE INDEX IF NOT EXISTS notes_daily ON notes(daily)`,
  `CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL)`,
  `INSERT OR IGNORE INTO counters(name, value) VALUES ('seq', 0)`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
    title, tags, text, content='notes', content_rowid='id',
    tokenize='unicode61 remove_diacritics 2'
  )`,
  `CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
    INSERT INTO notes_fts(rowid, title, tags, text) VALUES (new.id, new.title, new.tags, new.text);
  END`,
  `CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
    INSERT INTO notes_fts(notes_fts, rowid, title, tags, text) VALUES ('delete', old.id, old.title, old.tags, old.text);
  END`,
  `CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
    INSERT INTO notes_fts(notes_fts, rowid, title, tags, text) VALUES ('delete', old.id, old.title, old.tags, old.text);
    INSERT INTO notes_fts(rowid, title, tags, text) VALUES (new.id, new.title, new.tags, new.text);
  END`,
]
