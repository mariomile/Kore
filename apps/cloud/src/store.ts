import { dateFromDailyPath } from '@kore/core/graph/paths'
import { describeNote } from './note'
import { HISTORY_DAYS, SCHEMA } from './schema'

/** A live note as the store returns it. */
export interface StoredNote {
  path: string
  source: string
  title: string
  daily: string | null
  version: number
  seq: number
  updatedAt: string
}

/** One entry of the change feed: a live note, or a deletion (`source: null`). */
export interface Change {
  path: string
  source: string | null
  version: number
  seq: number
  updatedAt: string
  /** The agent that made this write, or null for the owner (the Kore app, the CLI). */
  author: string | null
}

/** A search hit: where it is, what it is called, and the matching passage. */
export interface SearchHit {
  path: string
  title: string
  daily: string | null
  snippet: string
}

/**
 * What a compare-and-swap write did. `conflict` carries the note as it is
 * now (`source: null` when it is deleted or absent) so the caller can merge
 * and retry instead of overwriting a change it has not seen.
 */
export type WriteOutcome =
  | { status: 'ok'; version: number; seq: number }
  | { status: 'conflict'; version: number; source: string | null }

/** One write in a batch: `source: null` deletes. */
export interface WriteRequest {
  path: string
  source: string | null
  /** The version the writer last saw; 0 for a note it believes is new. */
  baseVersion: number
  /**
   * Title, tags and text the writer already parsed with the same core parser
   * (the Kore app does), so the Worker spends no CPU on Markdown. Absent: the
   * store parses the source itself.
   */
  meta?: NoteText | undefined
  /** The agent making the write; null or absent for the owner. */
  author?: string | null | undefined
}

/** One kept earlier version of a note, without its text. */
export interface NoteVersion {
  id: number
  path: string
  version: number
  /** Who wrote this version; null for the owner. */
  author: string | null
  writtenAt: string
  /** When the next write replaced it (or deleted the note). */
  replacedAt: string
  replacedBy: string | null
  /** The write that replaced it was a deletion. */
  deleted: boolean
}

/** A kept version with its text, for showing or restoring it. */
export interface NoteVersionSource extends NoteVersion {
  source: string
}

/** How many live notes there are and how many were deleted since a moment. */
export interface DeletionPressure {
  live: number
  recentlyDeleted: number
}

interface VersionRow {
  id: number
  path: string
  version: number
  author: string | null
  written_at: string
  replaced_at: string
  replaced_by: string | null
  deleted: number
}

const VERSION_COLUMNS = 'id, path, version, author, written_at, replaced_at, replaced_by, deleted'

function toVersion(row: VersionRow): NoteVersion {
  return {
    id: row.id,
    path: row.path,
    version: row.version,
    author: row.author,
    writtenAt: row.written_at,
    replacedAt: row.replaced_at,
    replacedBy: row.replaced_by,
    deleted: row.deleted === 1,
  }
}

/** The ISO time `days` before `iso`. */
function daysBefore(iso: string, days: number): string {
  return new Date(Date.parse(iso) - days * 86_400_000).toISOString()
}

/** The parsed parts of a note the search index needs. */
export interface NoteText {
  title: string
  tags: readonly string[]
  text: string
}

interface NoteRow {
  path: string
  source: string
  title: string
  daily: string | null
  version: number
  seq: number
  updated_at: string
  deleted: number
  author: string | null
}

/**
 * A batch reserves its `seq` numbers with one counter bump, then the k-th of
 * n writes takes `counter - (n - 1 - k)`: one statement per batch instead of
 * one per write, which matters under D1's per-invocation query cap.
 */
const RESERVE_SEQ = `UPDATE counters SET value = value + ?1 WHERE name = 'seq'`
function seqAt(offsetParam: string): string {
  return `(SELECT value FROM counters WHERE name = 'seq') - ${offsetParam}`
}

/**
 * Upsert guarded by the writer's base version. A new path always inserts
 * (version 1); an existing one updates only when its version is the one the
 * writer saw, or when it is a tombstone and the writer believes it is new.
 * No row comes back on a mismatch, which is how a conflict is detected.
 */
const UPSERT = `INSERT INTO notes(path, source, title, tags, text, daily, version, seq, updated_at, deleted, author)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ${seqAt('?9')}, ?7, 0, ?10)
  ON CONFLICT(path) DO UPDATE SET
    source = excluded.source, title = excluded.title, tags = excluded.tags, text = excluded.text,
    daily = excluded.daily, version = notes.version + 1, seq = excluded.seq,
    updated_at = excluded.updated_at, deleted = 0, author = excluded.author
  WHERE notes.version = ?8 OR (notes.deleted = 1 AND ?8 = 0)
  RETURNING version, seq`

/** Tombstone guarded the same way; a note already gone is left alone. */
const TOMBSTONE = `UPDATE notes SET source = '', title = '', tags = '', text = '', daily = NULL,
    deleted = 1, version = version + 1, seq = ${seqAt('?4')}, updated_at = ?3, author = ?5
  WHERE path = ?1 AND version = ?2 AND deleted = 0
  RETURNING version, seq`

/** Quote every term so input is never FTS5 syntax; the last one matches as a prefix. */
export function ftsQuery(query: string): string {
  const terms = query.match(/[\p{L}\p{N}_]+/gu) ?? []
  return terms.map((term, index) => `"${term}"${index === terms.length - 1 ? '*' : ''}`).join(' ')
}

function toStored(row: NoteRow): StoredNote {
  return {
    path: row.path,
    source: row.source,
    title: row.title,
    daily: row.daily,
    version: row.version,
    seq: row.seq,
    updatedAt: row.updated_at,
  }
}

const ROW_COLUMNS = 'path, source, title, daily, version, seq, updated_at, deleted, author'

/**
 * The vault in D1: reads, full-text search, the change feed, and the only
 * write primitive, a batch of compare-and-swap writes. Every write bumps the
 * vault-wide `seq` inside the same D1 batch (a transaction), so the change
 * feed never skips a write and a failed write leaves at most a gap.
 */
export class NoteStore {
  readonly #db: D1Database
  readonly #now: () => string

  constructor(db: D1Database, now: () => string = () => new Date().toISOString()) {
    this.#db = db
    this.#now = now
  }

  /** Create or upgrade the tables. Idempotent. */
  async ensureSchema(): Promise<void> {
    await this.#db.batch(SCHEMA.map((statement) => this.#db.prepare(statement)))
  }

  /**
   * Add one to the counter `name` unless it already reached `cap`; true when
   * it was counted. Guards writes that anyone with the URL can trigger.
   */
  async countUnder(name: string, cap: number): Promise<boolean> {
    const row = await this.#db
      .prepare(
        `INSERT INTO counters(name, value) VALUES (?1, 1)
         ON CONFLICT(name) DO UPDATE SET value = value + 1 WHERE value < ?2
         RETURNING value`,
      )
      .bind(name, cap)
      .first<{ value: number }>()
    return row !== null
  }

  /** The live note at `path`, or null (absent, deleted). */
  async get(path: string): Promise<StoredNote | null> {
    const row = await this.#db
      .prepare(`SELECT ${ROW_COLUMNS} FROM notes WHERE path = ?1 AND deleted = 0`)
      .bind(path)
      .first<NoteRow>()
    return row === null ? null : toStored(row)
  }

  /** The newest live note titled `title` (case-insensitive), or null. */
  async byTitle(title: string): Promise<StoredNote | null> {
    const row = await this.#db
      .prepare(
        `SELECT ${ROW_COLUMNS} FROM notes WHERE title = ?1 COLLATE NOCASE AND deleted = 0
         ORDER BY updated_at DESC LIMIT 1`,
      )
      .bind(title)
      .first<NoteRow>()
    return row === null ? null : toStored(row)
  }

  /** The daily note for an ISO date, or null. */
  async byDaily(date: string): Promise<StoredNote | null> {
    const row = await this.#db
      .prepare(`SELECT ${ROW_COLUMNS} FROM notes WHERE daily = ?1 AND deleted = 0 LIMIT 1`)
      .bind(date)
      .first<NoteRow>()
    return row === null ? null : toStored(row)
  }

  /** Ranked full-text hits: title weighs most, then tags, then body. */
  async search(query: string, limit: number): Promise<SearchHit[]> {
    const match = ftsQuery(query)
    if (match === '') {
      return []
    }
    const { results } = await this.#db
      .prepare(
        `SELECT n.path, n.title, n.daily, snippet(notes_fts, 2, '', '', '…', 16) AS snippet
         FROM notes_fts JOIN notes n ON n.id = notes_fts.rowid
         WHERE notes_fts MATCH ?1 AND n.deleted = 0
         ORDER BY bm25(notes_fts, 10.0, 5.0, 1.0) LIMIT ?2`,
      )
      .bind(match, limit)
      .all<SearchHit>()
    return results.map((hit) => ({ ...hit, snippet: hit.snippet.replaceAll(/\s+/g, ' ').trim() }))
  }

  /** Live notes, most recently written first. */
  async recent(limit: number): Promise<StoredNote[]> {
    const { results } = await this.#db
      .prepare(
        `SELECT ${ROW_COLUMNS} FROM notes WHERE deleted = 0 ORDER BY updated_at DESC LIMIT ?1`,
      )
      .bind(limit)
      .all<NoteRow>()
    return results.map(toStored)
  }

  /** Live note counts per top-level folder (`''` is the vault root). */
  async folders(): Promise<{ folder: string; notes: number }[]> {
    const { results } = await this.#db
      .prepare(
        `SELECT CASE WHEN instr(path, '/') > 0 THEN substr(path, 1, instr(path, '/') - 1) ELSE '' END
           AS folder, count(*) AS notes
         FROM notes WHERE deleted = 0 GROUP BY folder ORDER BY notes DESC`,
      )
      .all<{ folder: string; notes: number }>()
    return results
  }

  /** Writes after `since`, oldest first: what a client pulls to catch up. */
  async changes(since: number, limit: number): Promise<Change[]> {
    const { results } = await this.#db
      .prepare(`SELECT ${ROW_COLUMNS} FROM notes WHERE seq > ?1 ORDER BY seq LIMIT ?2`)
      .bind(since, limit)
      .all<NoteRow>()
    return results.map((row) => ({
      path: row.path,
      source: row.deleted === 1 ? null : row.source,
      version: row.version,
      seq: row.seq,
      updatedAt: row.updated_at,
      author: row.author,
    }))
  }

  /** One compare-and-swap write; see {@link writeMany}. */
  async write(request: WriteRequest): Promise<WriteOutcome> {
    const [outcome] = await this.writeMany([request])
    if (outcome === undefined) {
      throw new Error('write produced no outcome')
    }
    return outcome
  }

  /**
   * Apply compare-and-swap writes in one D1 batch, then read back the current
   * state of any that lost the race. Callers validate paths and privacy first;
   * the store only guards versions. Deleting a note that is already gone
   * succeeds with its current version.
   */
  async writeMany(requests: readonly WriteRequest[]): Promise<WriteOutcome[]> {
    if (requests.length === 0) {
      return []
    }
    const now = this.#now()
    const statements: D1PreparedStatement[] = [this.#db.prepare(RESERVE_SEQ).bind(requests.length)]
    for (const [index, request] of requests.entries()) {
      const offset = requests.length - 1 - index
      if (request.source === null) {
        statements.push(
          this.#db
            .prepare(TOMBSTONE)
            .bind(request.path, request.baseVersion, now, offset, request.author ?? null),
        )
      } else {
        const meta = {
          ...(request.meta ?? describeNote(request.path, request.source)),
          daily: dateFromDailyPath(request.path),
        }
        statements.push(
          this.#db
            .prepare(UPSERT)
            .bind(
              request.path,
              request.source,
              meta.title,
              meta.tags.join(' '),
              meta.text,
              meta.daily,
              now,
              request.baseVersion,
              offset,
              request.author ?? null,
            ),
        )
      }
    }
    statements.push(
      this.#db
        .prepare('DELETE FROM note_versions WHERE replaced_at < ?1')
        .bind(daysBefore(now, HISTORY_DAYS)),
    )
    const results = await this.#db.batch<{ version: number; seq: number }>(statements)
    const outcomes: (WriteOutcome | null)[] = requests.map((_, index) => {
      const row = results[index + 1]?.results[0]
      return row === undefined ? null : { status: 'ok', version: row.version, seq: row.seq }
    })
    const lost = requests.filter((_, index) => outcomes[index] === null).map(({ path }) => path)
    if (lost.length === 0) {
      return outcomes as WriteOutcome[]
    }
    const current = await this.#rows(lost)
    return outcomes.map((outcome, index) => {
      if (outcome !== null) {
        return outcome
      }
      const request = requests[index] as WriteRequest
      const row = current.get(request.path)
      if (request.source === null && (row === undefined || row.deleted === 1)) {
        return { status: 'ok', version: row?.version ?? 0, seq: row?.seq ?? 0 }
      }
      return {
        status: 'conflict',
        version: row?.version ?? 0,
        source: row === undefined || row.deleted === 1 ? null : row.source,
      }
    })
  }

  /** A note's kept versions, newest first (the live one is not among them). */
  async history(path: string, limit: number): Promise<NoteVersion[]> {
    const { results } = await this.#db
      .prepare(
        `SELECT ${VERSION_COLUMNS} FROM note_versions WHERE path = ?1
         ORDER BY replaced_at DESC, id DESC LIMIT ?2`,
      )
      .bind(path, limit)
      .all<VersionRow>()
    return results.map(toVersion)
  }

  /** One kept version with its text, or null when it was pruned or never existed. */
  async version(id: number): Promise<NoteVersionSource | null> {
    const row = await this.#db
      .prepare(`SELECT ${VERSION_COLUMNS}, source FROM note_versions WHERE id = ?1`)
      .bind(id)
      .first<VersionRow & { source: string }>()
    return row === null ? null : { ...toVersion(row), source: row.source }
  }

  /**
   * Deleted notes still in the trash, most recently deleted first: each one's
   * last kept version, the text it had when it was deleted.
   */
  async trash(limit: number): Promise<NoteVersion[]> {
    const { results } = await this.#db
      .prepare(
        `SELECT ${VERSION_COLUMNS.split(', ')
          .map((column) => `v.${column}`)
          .join(', ')}
         FROM notes n JOIN note_versions v ON v.id = (
           SELECT max(id) FROM note_versions WHERE path = n.path AND deleted = 1
         )
         WHERE n.deleted = 1 ORDER BY n.updated_at DESC LIMIT ?1`,
      )
      .bind(limit)
      .all<VersionRow>()
    return results.map(toVersion)
  }

  /** Live notes, and notes deleted after `since`: what the mass-deletion guard weighs. */
  async deletionPressure(since: string): Promise<DeletionPressure> {
    const row = await this.#db
      .prepare(
        `SELECT (SELECT count(*) FROM notes WHERE deleted = 0) AS live,
           (SELECT count(*) FROM notes WHERE deleted = 1 AND updated_at > ?1) AS recentlyDeleted`,
      )
      .bind(since)
      .first<DeletionPressure>()
    return row ?? { live: 0, recentlyDeleted: 0 }
  }

  async #rows(paths: readonly string[]): Promise<Map<string, NoteRow>> {
    const placeholders = paths.map((_, index) => `?${index + 1}`).join(', ')
    const { results } = await this.#db
      .prepare(`SELECT ${ROW_COLUMNS} FROM notes WHERE path IN (${placeholders})`)
      .bind(...paths)
      .all<NoteRow>()
    return new Map(results.map((row) => [row.path, row]))
  }
}
