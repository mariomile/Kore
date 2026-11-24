import { sql, type RawBuilder } from 'kysely'
import { z } from 'zod'
import { isDaily } from '../graph/paths'
import { decodeTagTypeJson } from '../tags/tag-type'
import { foldTag } from '../markdown'
import { db } from './db'
import { recallOrder } from './filtered-search'
import { carriesTagOrNested } from './tag-match'
import { listUsedTagCounts } from './tag-tree'

/**
 * The All Notes list: every regular note, pinned first then newest, optionally
 * narrowed to one tag. The unfiltered list excludes daily notes — the stream is
 * their home — but a tag filter includes tagged daily notes alongside regular
 * notes. Templates remain boilerplate, not graph content.
 * Uncapped: the screen virtualizes, the row
 * snippet is the stored `preview` column (derived once at index time), and
 * neither query carries a per-row parameter, so list size has no SQL ceiling.
 */

/** One row of the All Notes list. */
export interface NoteListEntry {
  path: string
  title: string
  /** The indexed row preview (`buildIndexedNote`; may be empty). */
  snippet: string
  /** The note's body tags (first-seen casing), alphabetical. */
  tags: string[]
  /** File modification time (epoch ms) — the list's recency sort key. */
  mtime: number
  /** Pinned notes lead the list (V1 order) and show a pin marker. */
  isPinned: boolean
}

/** Indexed list row with its computed Inbox membership. */
export interface ClassifiedNoteListEntry extends NoteListEntry {
  isInbox: boolean
}

/** A folder page's population: one folder's notes, optionally with its subfolders'. */
export interface NoteListFolder {
  /** Graph-relative folder path (no trailing slash). */
  readonly path: string
  /** Include notes in every folder below `path`, not just its own. */
  readonly recursive: boolean
}

export interface NoteListOptions {
  /**
   * Only notes carrying this tag or a tag nested under it (case-insensitive).
   * `null` lists all.
   */
  tag?: string | null
  /**
   * Only notes filed under this folder — every kind the folder tree shows,
   * dailies and templates included, since the page mirrors the folder.
   * Takes precedence over `tag`.
   */
  folder?: NoteListFolder | null
}

/**
 * Notes for the All Notes screen: unfiltered lists include non-daily notes only;
 * tag-filtered lists include both regular and daily notes carrying the tag; a
 * folder page lists whatever is filed in the folder.
 * Pinned notes appear first (explicit pin order, then unordered pins), then most
 * recently edited — V1's list order.
 */
export async function listNotes(options: NoteListOptions = {}): Promise<ClassifiedNoteListEntry[]> {
  const tag = options.tag ?? null
  const folder = options.folder ?? null

  // One query, not two. The tags used to come back as their own uncapped
  // listing (roughly 9,000 rows on a 4,500-note graph) and were stitched to the
  // list in JS. Folding them in with `group_concat` deletes that whole round
  // trip, along with the per-row `serde_json::Map` the Rust query bridge builds
  // for each of those rows.
  //
  // The tag filter (the tag or any tag nested under it) is an `EXISTS` rather than a join: joining the filter tag
  // would multiply the grouped rows whenever a note matched more than once, and
  // the old `distinct()` that guarded against that cannot coexist with the
  // aggregate. `EXISTS` narrows without duplicating, so the grouping is exact.
  let listQuery = db
    .selectFrom('notes')
    .leftJoin('tags', 'tags.notePath', 'notes.path')
    .leftJoin('tagTypes', 'tagTypes.tagKey', 'tags.tagKey')
    .select([
      'notes.path',
      'notes.title',
      'notes.mtime',
      'notes.preview',
      'notes.isPinned',
      'notes.pinnedOrder',
      // Ordered on the folded key so a row's tags read in the same alphabetical
      // order as the facet list, regardless of display casing. The separator is
      // the ASCII unit separator: the `#tag` grammar cannot produce a control
      // character, so it can never appear inside a tag and split one in half.
      sql<string | null>`group_concat("tags"."tag", char(31) ORDER BY "tags"."tag_key")`.as('tags'),
      sql<string>`json_group_array("tag_types"."schema_json")`.as('tagSchemas'),
    ])
    .groupBy('notes.path')

  listQuery =
    folder !== null
      ? listQuery.where(folderMembership(folder))
      : tag === null
        ? listQuery.where('notes.kind', '=', 'note')
        : listQuery
            .where('notes.kind', 'in', ['note', 'daily'])
            .where(carriesTagOrNested('"notes"."path"', tag))

  for (const order of recallOrder(true)) {
    listQuery = listQuery.orderBy(order)
  }
  const rows = await listQuery.execute()
  // A schema is shared by many notes. Validate each distinct definition once
  // per result, including malformed definitions. A per-call cache cannot
  // survive a schema edit or a graph switch and retains no parsed objects.
  const schemaValidity = new Map<string, boolean>()

  return rows.map((row) => ({
    path: row.path,
    title: row.title,
    mtime: row.mtime,
    snippet: row.preview,
    // `group_concat` yields null for a note with no tags, which is the common
    // case: splitting that string would hand back `['']`, a phantom empty tag.
    tags: row.tags === null ? [] : row.tags.split(TAG_SEPARATOR),
    isPinned: row.isPinned !== 0,
    isInbox: !isDaily(row.path) && !hasValidTagSchema(row.tagSchemas, schemaValidity),
  }))
}

/**
 * The SQL predicate for "filed under `folder`": a path prefix compared with
 * `substr`, not `LIKE`, so `_` and `%` in folder names match literally and
 * case stays significant (the tree groups paths case-sensitively too).
 * SQLite counts text in code points, hence `Array.from` for the length.
 */
function folderMembership(folder: NoteListFolder): RawBuilder<boolean> {
  const prefix = folder.path === '' ? '' : `${folder.path}/`
  const length = Array.from(prefix).length
  const under = sql<boolean>`substr("notes"."path", 1, ${length}) = ${prefix}`
  return folder.recursive
    ? under
    : sql<boolean>`${under} and instr(substr("notes"."path", ${length + 1}), '/') = 0`
}

/** One of a folder's most recently edited notes (a folder card's peek). */
export interface FolderPeekNote {
  readonly path: string
  readonly title: string
}

/**
 * Each folder's `perFolder` most recently edited notes, its subfolders'
 * included, newest first: what a folder card shows of what is inside.
 * One query for every folder, however many: each note is matched to the
 * folders it is filed under by the same path prefix as {@link listNotes}'s
 * folder pages, ranked within each, and only the top ones come back.
 * A folder with no notes is absent from the map.
 */
export async function recentNotesByFolder(
  folders: readonly string[],
  perFolder: number,
): Promise<ReadonlyMap<string, readonly FolderPeekNote[]>> {
  const peeks = new Map<string, FolderPeekNote[]>()
  if (folders.length === 0 || perFolder < 1) {
    return peeks
  }
  // `length` counts code points, like `substr`, so a prefix with accents or
  // emoji compares the same text the tree grouped by.
  const prefixes = sql.join(folders.map((folder) => sql`(${folder}, ${`${folder}/`})`))
  const result = await sql<{ folder: string; path: string; title: string }>`
    WITH folders(folder, prefix) AS (VALUES ${prefixes})
    SELECT folder, path, title FROM (
      SELECT
        folders.folder AS folder,
        notes.path AS path,
        notes.title AS title,
        row_number() OVER (
          PARTITION BY folders.folder ORDER BY notes.mtime DESC, notes.path
        ) AS rank
      FROM folders
      JOIN notes ON substr(notes.path, 1, length(folders.prefix)) = folders.prefix
    )
    WHERE rank <= ${perFolder}
    ORDER BY folder, rank
  `.execute(db)
  for (const row of result.rows) {
    const notes = peeks.get(row.folder)
    const note = { path: row.path, title: row.title }
    if (notes === undefined) {
      peeks.set(row.folder, [note])
    } else {
      notes.push(note)
    }
  }
  return peeks
}

/** Match the properties panel: a malformed schema does not make a tag typed. */
function hasValidTagSchema(column: string, validity: Map<string, boolean>): boolean {
  // Most rows carry no schema at all (`[null]`, or one null per untyped
  // tag). A JSON array without a string has nothing to validate, and
  // skipping the parse matters when the list holds thousands of notes.
  if (!column.includes('"')) {
    return false
  }
  const schemas = z.array(z.string().nullable()).parse(JSON.parse(column))
  return schemas.some((schema) => {
    if (schema === null) return false
    const cached = validity.get(schema)
    if (cached !== undefined) return cached
    try {
      decodeTagTypeJson(schema)
      validity.set(schema, true)
      return true
    } catch {
      validity.set(schema, false)
      return false
    }
  })
}

/** ASCII unit separator, the `char(31)` the tag `group_concat` joins on. */
const TAG_SEPARATOR = '\u{1F}'

/** One row of the recent-notes listing (the AI chat's recents tool). */
export interface RecentNoteRow {
  path: string
  title: string
  /** The indexed row preview (`buildIndexedNote`; may be empty). */
  preview: string
  /** File modification time (epoch ms). */
  mtime: number
  isPrivate: boolean
}

export interface RecentNotesOptions {
  /** Row cap — the most recently edited notes win. */
  limit: number
  /** Only notes carrying this tag (case-insensitive). `null` lists all. */
  tag?: string | null
}

/**
 * The most recently edited non-daily notes, newest first. Same population as
 * {@link listNotes} (dailies live in their own date-keyed listing) but capped,
 * without the per-note tag fetch, and with private notes excluded in SQL so
 * they don't consume cap slots — the AI privacy gate still re-checks every
 * row live before anything leaves the device.
 */
export async function listRecentNotes(options: RecentNotesOptions): Promise<RecentNoteRow[]> {
  const tag = options.tag ?? null

  const rows =
    tag === null
      ? await db
          .selectFrom('notes')
          .where('notes.kind', '=', 'note')
          .where('notes.isPrivate', '=', 0)
          .select(['notes.path', 'notes.title', 'notes.preview', 'notes.mtime', 'notes.isPrivate'])
          .orderBy('notes.mtime', 'desc')
          .orderBy('notes.path')
          .limit(options.limit)
          .execute()
      : await db
          .selectFrom('tags')
          .innerJoin('notes', 'notes.path', 'tags.notePath')
          .where('tags.tagKey', '=', foldTag(tag))
          .where('notes.kind', '=', 'note')
          .where('notes.isPrivate', '=', 0)
          .select(['notes.path', 'notes.title', 'notes.preview', 'notes.mtime', 'notes.isPrivate'])
          .distinct()
          .orderBy('notes.mtime', 'desc')
          .orderBy('notes.path')
          .limit(options.limit)
          .execute()
  return rows.map((row) => ({ ...row, isPrivate: row.isPrivate !== 0 }))
}

/** One tag facet over the note list: display casing + non-daily note count. */
export interface NoteTagFacet {
  tag: string
  count: number
}

export interface ListNoteTagsOptions {
  /**
   * Count non-private notes only. Outbound surfaces (the AI tools) pass
   * this so a tag carried solely by `private: true` notes never reaches
   * their layer and no count reveals a private note; the user's own sidebar
   * omits it — privacy blocks external services, not their screen.
   */
  excludePrivate?: boolean
}

/**
 * Every tag carried by at least one non-daily note, alphabetical, with how
 * many such notes carry it or a tag nested under it — the count of notes the
 * tag's page (the prefix-matching filter above) lists. Grouped on the stored
 * `tag_key`, matching the tag filter (and the `#tag` search token): `#Book`
 * and `#book` are one facet, displayed with one deterministic casing.
 */
export async function listNoteTags(options: ListNoteTagsOptions = {}): Promise<NoteTagFacet[]> {
  return await listUsedTagCounts(options)
}

/** One `tags` row: a note and a tag it carries, display casing. */
export interface TagOccurrence {
  notePath: string
  tag: string
}

/**
 * Every place `tags` or a tag nested under one of them occurs, in any note
 * kind (templates and definitions included) and whether the note is a member
 * or only mentions it in prose. A rename has to reach all of them, where a
 * collection shows only members. Key ranges, as in `carriesTagOrNested`, so
 * the query stays on the `tag_key` index.
 */
export async function listTagOccurrences(tags: readonly string[]): Promise<TagOccurrence[]> {
  const keys = [...new Set(tags.map(foldTag))]
  if (keys.length === 0) {
    return []
  }
  return await db
    .selectFrom('tags')
    .select(['tags.notePath', 'tags.tag'])
    .where((eb) =>
      eb.or(
        keys.flatMap((key) => [
          eb('tags.tagKey', '=', key),
          eb.and([eb('tags.tagKey', '>=', `${key}/`), eb('tags.tagKey', '<', `${key}0`)]),
        ]),
      ),
    )
    .execute()
}
