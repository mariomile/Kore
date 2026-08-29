import { sql } from 'kysely'
import { foldTag } from '../markdown'
import { db } from './db'
import { recallOrder } from './filtered-search'

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

export interface NoteListOptions {
  /** Only notes carrying this tag (case-insensitive). `null` lists all. */
  tag?: string | null
}

/**
 * Notes for the All Notes screen: unfiltered lists include non-daily notes only;
 * tag-filtered lists include both regular and daily notes carrying the tag.
 * Pinned notes appear first (explicit pin order, then unordered pins), then most
 * recently edited — V1's list order.
 */
export async function listNotes(options: NoteListOptions = {}): Promise<NoteListEntry[]> {
  const tag = options.tag ?? null

  // One query, not two. The tags used to come back as their own uncapped
  // listing (roughly 9,000 rows on a 4,500-note graph) and were stitched to the
  // list in JS. Folding them in with `group_concat` deletes that whole round
  // trip, along with the per-row `serde_json::Map` the Rust query bridge builds
  // for each of those rows.
  //
  // The tag filter is an `EXISTS` rather than a join: joining the filter tag
  // would multiply the grouped rows whenever a note matched more than once, and
  // the old `distinct()` that guarded against that cannot coexist with the
  // aggregate. `EXISTS` narrows without duplicating, so the grouping is exact.
  let listQuery = db
    .selectFrom('notes')
    .leftJoin('tags', 'tags.notePath', 'notes.path')
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
    ])
    .groupBy('notes.path')

  listQuery =
    tag === null
      ? listQuery.where('notes.kind', '=', 'note')
      : listQuery.where('notes.kind', 'in', ['note', 'daily']).where(
          sql<boolean>`exists (
            select 1 from "tags" as "filter_tags"
            where "filter_tags"."note_path" = "notes"."path"
              and "filter_tags"."tag_key" = ${foldTag(tag)}
          )`,
        )

  for (const order of recallOrder(true)) {
    listQuery = listQuery.orderBy(order)
  }
  const rows = await listQuery.execute()

  return rows.map((row) => ({
    path: row.path,
    title: row.title,
    mtime: row.mtime,
    snippet: row.preview,
    // `group_concat` yields null for a note with no tags, which is the common
    // case: splitting that string would hand back `['']`, a phantom empty tag.
    tags: row.tags === null ? [] : row.tags.split(TAG_SEPARATOR),
    isPinned: row.isPinned !== 0,
  }))
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

/**
 * Every tag carried by at least one non-daily note, with how many such notes
 * carry it, alphabetical. Grouped on the stored `tag_key`, matching the tag
 * filter (and the `#tag` search token): `#Book` and `#book` are one facet,
 * displayed with one deterministic casing.
 */
export async function listNoteTags(): Promise<NoteTagFacet[]> {
  return await db
    .selectFrom('tags')
    .innerJoin('notes', 'notes.path', 'tags.notePath')
    .where('notes.kind', '=', 'note')
    .select([sql<string>`min(tags.tag)`.as('tag'), sql<number>`count(*)`.as('count')])
    .groupBy('tags.tagKey')
    .orderBy('tags.tagKey')
    .execute()
}
