/** While one writer keeps editing a note, its history keeps one snapshot per this many minutes. */
export const SNAPSHOT_MINUTES = 10

/** How long history and the trash keep a replaced or deleted note. */
export const HISTORY_DAYS = 365

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
 * `note_versions` is the history: before a write replaces or deletes a live
 * note, the old text is kept, at most one snapshot per note every ten minutes
 * while the same writer keeps typing, always on a deletion or a change of
 * writer. A deleted note's text lives on there (the trash) until the 12-month
 * retention prunes it.
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
    deleted INTEGER NOT NULL DEFAULT 0,
    author TEXT
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
  `CREATE TABLE IF NOT EXISTS note_versions (
    id INTEGER PRIMARY KEY,
    path TEXT NOT NULL,
    version INTEGER NOT NULL,
    source TEXT NOT NULL,
    author TEXT,
    written_at TEXT NOT NULL,
    replaced_at TEXT NOT NULL,
    replaced_by TEXT,
    deleted INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS note_versions_path ON note_versions(path, replaced_at)`,
  `CREATE INDEX IF NOT EXISTS note_versions_age ON note_versions(replaced_at)`,
  `CREATE TRIGGER IF NOT EXISTS notes_snapshot BEFORE UPDATE OF version ON notes
    WHEN old.deleted = 0 AND (
      new.deleted = 1
      OR old.author IS NOT new.author
      OR NOT EXISTS (
        SELECT 1 FROM note_versions v WHERE v.path = old.path
          AND v.replaced_at > strftime('%Y-%m-%dT%H:%M:%fZ', new.updated_at, '-${SNAPSHOT_MINUTES} minutes')
      )
    )
  BEGIN
    INSERT INTO note_versions(path, version, source, author, written_at, replaced_at, replaced_by, deleted)
    VALUES (old.path, old.version, old.source, old.author, old.updated_at, new.updated_at, new.author, new.deleted);
  END`,
]
