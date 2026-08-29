import { sql } from 'kysely'
import { db } from './db'
import { isProjectionCurrent } from './queries'
import type { NoteTagFacet } from './note-list'

/**
 * Aggregates for the Insights view: headline counts, the most-linked notes,
 * a writing-activity series, and the most-used tags. Read-only projections
 * over the index — nothing here leaves the device, so unlike the AI-facing
 * {@link loadGraphStats} these figures may include private notes' *counts*
 * (never their content); the most-linked list still excludes private notes
 * because it surfaces titles.
 */

/** One note in the most-linked ranking. */
export interface LinkedNoteRank {
  path: string
  title: string
  dailyDate: string | null
  /** Inbound wiki/markdown links from other notes. */
  backlinks: number
}

/** Notes edited on one day (from the index's `updated_at`). */
export interface ActivityDay {
  /** ISO `YYYY-MM-DD`, local to how mtimes were recorded. */
  date: string
  edited: number
}

export interface GraphInsights {
  noteCount: number
  dailyNoteCount: number
  openTaskCount: number
  completedTaskCount: number
  tagCount: number
  mostLinked: LinkedNoteRank[]
  activity: ActivityDay[]
  topTags: NoteTagFacet[]
}

/**
 * Graph-relative paths of every `private: true` note, or `null` when the index
 * cannot answer. The CLI chat engines turn these into per-file Read deny rules
 * — the privacy hard block for an engine that reads files itself instead of
 * using the checked note tools.
 *
 * `null` is not an error channel, it is the third answer. The projection is
 * wiped and refilled one note at a time on every {@link PROJECTION_VERSION}
 * bump, so during a rebuild the query succeeds and returns a list that is
 * empty, then partial. A partial list is the dangerous shape: it looks like a
 * real answer while silently omitting the notes not yet re-indexed. Callers
 * must treat `null` exactly as they treat a throw and refuse the run.
 */
export async function listPrivateNotePaths(): Promise<string[] | null> {
  if (!(await isProjectionCurrent())) {
    return null
  }
  const rows = await db.selectFrom('notes').where('isPrivate', '=', 1).select('path').execute()
  return rows.map((row) => row.path)
}

export interface GraphInsightsOptions {
  /** How many most-linked notes to rank. */
  linkedLimit: number
  /** How many top tags to list. */
  tagLimit: number
  /** Activity window start, ISO `YYYY-MM-DD` (inclusive). */
  activitySince: string
}

/** Load {@link GraphInsights} from the active graph's index. */
export async function loadGraphInsights({
  linkedLimit,
  tagLimit,
  activitySince,
}: GraphInsightsOptions): Promise<GraphInsights> {
  const [notesRow, tasksRow, tagRow, linkedRows, activityRows, tagRows] = await Promise.all([
    db
      .selectFrom('notes')
      .select([
        sql<number>`sum(case when kind = 'note' then 1 else 0 end)`.as('notes'),
        sql<number>`sum(case when daily_date is not null then 1 else 0 end)`.as('dailies'),
      ])
      .executeTakeFirst(),
    db
      .selectFrom('tasks')
      .innerJoin('notes', 'notes.path', 'tasks.notePath')
      .where('notes.kind', '!=', 'template')
      .select([
        sql<number>`sum(case when checked = 0 then 1 else 0 end)`.as('open'),
        sql<number>`sum(case when checked = 1 then 1 else 0 end)`.as('done'),
      ])
      .executeTakeFirst(),
    db
      .selectFrom('tags')
      .select(sql<number>`count(distinct tag_key)`.as('count'))
      .executeTakeFirst(),
    // Inbound links resolved the lexical way (target key = title key), self
    // links excluded, one row per source position — a note that links twice
    // counts twice, which is what "most referenced" should mean.
    db
      .selectFrom('links')
      .innerJoin('notes', 'notes.titleKey', 'links.targetKey')
      .where('notes.isPrivate', '=', 0)
      .whereRef('notes.path', '!=', 'links.sourcePath')
      .select([
        'notes.path',
        'notes.title',
        'notes.dailyDate',
        sql<number>`count(*)`.as('backlinks'),
      ])
      .groupBy('notes.path')
      .orderBy('backlinks', 'desc')
      .orderBy('notes.title')
      .limit(linkedLimit)
      .execute(),
    db
      .selectFrom('notes')
      .where('updatedAt', '>', 0)
      // `localtime` matters: the heatmap grid and `activitySince` are local
      // days (date-fns), so bucketing in UTC would file an evening edit under
      // tomorrow — invisible until the calendar catches up.
      .where(sql<string>`date(updated_at / 1000, 'unixepoch', 'localtime')`, '>=', activitySince)
      .select([
        sql<string>`date(updated_at / 1000, 'unixepoch', 'localtime')`.as('date'),
        sql<number>`count(*)`.as('edited'),
      ])
      .groupBy(sql`date(updated_at / 1000, 'unixepoch', 'localtime')`)
      .orderBy('date')
      .execute(),
    db
      .selectFrom('tags')
      .innerJoin('notes', 'notes.path', 'tags.notePath')
      .where('notes.kind', '=', 'note')
      .select([sql<string>`min(tags.tag)`.as('tag'), sql<number>`count(*)`.as('count')])
      .groupBy('tags.tagKey')
      .orderBy(sql`count(*)`, 'desc')
      .orderBy('tags.tagKey')
      .limit(tagLimit)
      .execute(),
  ])

  return {
    noteCount: notesRow?.notes ?? 0,
    dailyNoteCount: notesRow?.dailies ?? 0,
    openTaskCount: tasksRow?.open ?? 0,
    completedTaskCount: tasksRow?.done ?? 0,
    tagCount: tagRow?.count ?? 0,
    mostLinked: linkedRows,
    activity: activityRows,
    topTags: tagRows,
  }
}
