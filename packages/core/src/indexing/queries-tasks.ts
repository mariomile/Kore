import { sql, type SqlBool } from 'kysely'
import { foldTag, type TaskMarker } from '../markdown'
import { db } from './db'
import { decodeTaskBreadcrumbs } from './indexed-note'
import { isFolderNotePath, type TaskLineLink } from './task-views'

/**
 * One open task plus the note context the Tasks view (Plan 18) groups and
 * renders by.
 */
export interface OpenTask extends TaskMarker {
  notePath: string
  /** Whether the checkbox is ticked. Open lists are all `false`; archived rows are `true`. */
  checked: boolean
  /** Display text, markdown stripped. */
  text: string
  /** Parent outline/list item text, top-down, displayed above the task row. */
  breadcrumbs: readonly string[]
  noteTitle: string
  /** The task's explicit `[[YYYY-MM-DD]]` due date, or null. */
  dueDate: string | null
  /** Local `HH:MM` on {@link dueDate}, or null when the task is date-only. */
  dueTime: string | null
  /** The nearest top-level heading above the task (level 2+), or null. */
  section: string | null
  /** ISO date for daily-note tasks; null for tasks in regular notes. */
  dailyDate: string | null
  /** Pin flag mapped to a real boolean at the read boundary. */
  isPinned: boolean
  pinnedOrder: number | null
  updatedAt: number
}

function taskRowsQuery() {
  return db
    .selectFrom('tasks')
    .innerJoin('notes', 'notes.path', 'tasks.notePath')
    .where('notes.kind', '!=', 'template')
    .select([
      'tasks.notePath',
      'tasks.markerOffset',
      'tasks.raw',
      'tasks.text',
      'tasks.breadcrumbs',
      'tasks.checked',
      'tasks.dueDate',
      'tasks.dueTime',
      'tasks.section',
      'notes.title as noteTitle',
      'notes.dailyDate',
      'notes.isPinned',
      'notes.pinnedOrder',
      'notes.updatedAt',
    ])
}

/** Map one raw SQL row to its domain shape: 0/1 flags to booleans, the
 * breadcrumbs column decoded. The raw fields are destructured away so the
 * stored `breadcrumbs: string` never leaks past this boundary. */
function toTaskRow<Row extends { checked: number; isPinned: number; breadcrumbs: string }>(
  row: Row,
): Omit<Row, 'checked' | 'isPinned' | 'breadcrumbs'> & {
  checked: boolean
  isPinned: boolean
  breadcrumbs: readonly string[]
} {
  const { checked, isPinned, breadcrumbs, ...task } = row
  return {
    ...task,
    checked: checked !== 0,
    isPinned: isPinned !== 0,
    breadcrumbs: decodeTaskBreadcrumbs(breadcrumbs),
  }
}

/**
 * Every open task across the graph, with note context, for the Tasks view.
 * Private notes' tasks are included because this is a local-only surface.
 */
export async function getOpenTasks(): Promise<OpenTask[]> {
  const rows = await taskRowsQuery()
    .where('tasks.checked', '=', 0)
    .orderBy('tasks.notePath')
    .orderBy('tasks.markerOffset')
    .execute()
  return rows.map(toTaskRow)
}

/**
 * Completed tasks across the graph, most-recently-edited note first — the
 * Tasks view's "show archived" surface.
 */
export async function getCompletedTasks(): Promise<OpenTask[]> {
  const rows = await taskRowsQuery()
    .where('tasks.checked', '=', 1)
    .orderBy('notes.updatedAt', 'desc')
    .orderBy('tasks.markerOffset')
    .execute()
  return rows.map(toTaskRow)
}

/**
 * The graph's folder notes (`…/<Name>/<Name>.md`) — the projects the Tasks
 * view's Projects grouping gathers a folder's notes under
 * ({@link import('./task-views').projectForNote}).
 */
export async function getProjectNotePaths(): Promise<string[]> {
  const rows = await db
    .selectFrom('notes')
    .where('notes.kind', '!=', 'template')
    .select('notes.path')
    .execute()
  return rows.map((row) => row.path).filter(isFolderNotePath)
}

/** An ISO `[[YYYY-MM-DD]]` target is a due-date association, not a reference. */
const CALENDAR_TARGET_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Whether a backlink row makes its task a member of the linked note: the
 * link must sit inside the task's own line and be a real reference (a
 * calendar target is the task's due date instead). The view's columns type
 * as nullable, so the guard doubles as the narrowing. Positions compare in
 * TypeScript because `markerOffset`, the link span, and JS `String.length`
 * all count UTF-16 code units from the same parse — SQLite's `length()`
 * counts code points and would drift on astral characters.
 */
function linkInsideTaskLine(
  linkPos: number | null,
  linkTarget: string | null,
  markerOffset: number,
  raw: string,
): boolean {
  if (linkPos === null || linkTarget === null) {
    return false
  }
  if (CALENDAR_TARGET_RE.test(linkTarget.trim())) {
    return false
  }
  return linkPos >= markerOffset && linkPos < markerOffset + raw.length
}

/**
 * The SQL side of {@link linkInsideTaskLine}, so a note with many tasks and
 * many links does not return every (task × link) pair for TypeScript to
 * discard. The bound uses the line's UTF-8 byte length, which is never less
 * than its UTF-16 length: it can only admit extra rows, never drop one the
 * exact check above would keep.
 */
const linkMayBeOnTaskLine = sql<SqlBool>`"backlinks"."pos_from" >= "tasks"."marker_offset"
  and "backlinks"."pos_from" < "tasks"."marker_offset" + length(cast("tasks"."raw" as blob))`

/**
 * Every resolved wiki link written on a task's own line, in line order — what
 * {@link import('./task-views').linkedProjectsByTask} reads to count a
 * `+ [ ] … [[Project]]` task under that project. Open and completed tasks
 * both, so a just-completed row stays in its project while it shows struck.
 * Due-date `[[YYYY-MM-DD]]` links are the task's date, never a reference.
 */
export async function getTaskProjectLinks(): Promise<TaskLineLink[]> {
  const rows = await db
    .selectFrom('tasks')
    .innerJoin('notes', 'notes.path', 'tasks.notePath')
    .innerJoin('backlinks', 'backlinks.sourcePath', 'tasks.notePath')
    .where('notes.kind', '!=', 'template')
    .where('backlinks.kind', '=', 'wiki')
    .where('backlinks.targetPath', 'is not', null)
    .whereRef('backlinks.targetPath', '!=', 'tasks.notePath')
    .where(linkMayBeOnTaskLine)
    .select([
      'tasks.notePath',
      'tasks.markerOffset',
      'tasks.raw',
      'backlinks.posFrom as linkPos',
      'backlinks.targetRaw as linkTarget',
      'backlinks.targetPath',
    ])
    .orderBy('tasks.notePath')
    .orderBy('tasks.markerOffset')
    .orderBy('backlinks.posFrom')
    .execute()
  const links: TaskLineLink[] = []
  for (const row of rows) {
    if (
      row.targetPath === null ||
      !linkInsideTaskLine(row.linkPos, row.linkTarget, row.markerOffset, row.raw)
    ) {
      continue
    }
    links.push({
      notePath: row.notePath,
      markerOffset: row.markerOffset,
      targetPath: row.targetPath,
    })
  }
  return links
}

/** One of a note's open tasks: written in the note, or linking it by name. */
export interface NoteTaskRef extends OpenTask {
  /** False for a task written in the note itself; true for a task elsewhere
   * whose own line wiki-links this note. */
  linked: boolean
}

/**
 * The note's open tasks, for its context-rail Tasks panel: first the
 * checkboxes written in the note itself (document order), then every open
 * task anywhere whose **own line** wiki-links this note (most recently
 * edited source first). That line-level rule is what lets a note act as a
 * project: `+ [ ] call the surveyor [[House]]` captured in a daily note
 * still surfaces on House, while a note that merely mentions the project in
 * prose contributes nothing. The link is matched to its task line in
 * TypeScript — `markerOffset`, the link span, and JS `String.length` all
 * count UTF-16 code units from the same parse, where SQLite's `length()`
 * counts code points and would drift on astral characters. A calendar
 * `[[YYYY-MM-DD]]` target is the task's due date, never a reference.
 */
export async function getOpenTasksForNote(path: string): Promise<NoteTaskRef[]> {
  const own = await taskRowsQuery()
    .where('tasks.checked', '=', 0)
    .where('tasks.notePath', '=', path)
    .orderBy('tasks.markerOffset')
    .execute()
  const candidates = await taskRowsQuery()
    .innerJoin('backlinks', 'backlinks.sourcePath', 'tasks.notePath')
    .where('backlinks.targetPath', '=', path)
    .where('backlinks.kind', '=', 'wiki')
    .where('tasks.checked', '=', 0)
    .where('tasks.notePath', '!=', path)
    .where(linkMayBeOnTaskLine)
    .select(['backlinks.posFrom as linkPos', 'backlinks.targetRaw as linkTarget'])
    .orderBy('notes.updatedAt', 'desc')
    .orderBy('tasks.notePath')
    .orderBy('tasks.markerOffset')
    .execute()
  // One row per (task × matching link): keep tasks whose own line carries the
  // link, drop due-date links, and collapse a line that links the note twice.
  const seen = new Set<string>()
  const linked: typeof own = []
  for (const candidate of candidates) {
    const { linkPos, linkTarget, ...task } = candidate
    if (!linkInsideTaskLine(linkPos, linkTarget, task.markerOffset, task.raw)) {
      continue
    }
    const key = `${task.notePath} ${task.markerOffset}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    linked.push(task)
  }
  return [
    ...own.map((row) => ({ ...toTaskRow(row), linked: false })),
    ...linked.map((row) => ({ ...toTaskRow(row), linked: true })),
  ]
}

/** IN() lists stay well under SQLite's bound-parameter limit. */
const COUNT_CHUNK = 400

/**
 * Open-task counts for many notes at once — the collection views' badge
 * read ({@link getOpenTasksForNote} is the one-note detail read; membership
 * is the same rule: written in the note, or the task's own line wiki-links
 * it). Notes with zero open tasks are simply absent from the result.
 */
export async function countOpenTasksForNotes(
  paths: readonly string[],
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (let start = 0; start < paths.length; start += COUNT_CHUNK) {
    const chunk = paths.slice(start, start + COUNT_CHUNK)
    const own = await db
      .selectFrom('tasks')
      .innerJoin('notes', 'notes.path', 'tasks.notePath')
      .where('notes.kind', '!=', 'template')
      .where('tasks.checked', '=', 0)
      .where('tasks.notePath', 'in', chunk)
      .select(['tasks.notePath'])
      .execute()
    for (const row of own) {
      counts[row.notePath] = (counts[row.notePath] ?? 0) + 1
    }
    const linked = await db
      .selectFrom('backlinks')
      .innerJoin('tasks', 'tasks.notePath', 'backlinks.sourcePath')
      .innerJoin('notes', 'notes.path', 'tasks.notePath')
      .where('notes.kind', '!=', 'template')
      .where('backlinks.kind', '=', 'wiki')
      .where('backlinks.targetPath', 'in', chunk)
      .where('tasks.checked', '=', 0)
      .whereRef('tasks.notePath', '!=', 'backlinks.targetPath')
      .where(linkMayBeOnTaskLine)
      .select([
        'backlinks.targetPath',
        'backlinks.posFrom',
        'backlinks.targetRaw',
        'tasks.notePath',
        'tasks.markerOffset',
        'tasks.raw',
      ])
      .execute()
    // Each chunk owns its targets, so per-chunk dedupe is complete: one
    // count per (target, task), however many links the line carries.
    const seen = new Set<string>()
    for (const row of linked) {
      if (
        row.targetPath === null ||
        !linkInsideTaskLine(row.posFrom, row.targetRaw, row.markerOffset, row.raw)
      ) {
        continue
      }
      const key = `${row.targetPath} ${row.notePath} ${row.markerOffset}`
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      counts[row.targetPath] = (counts[row.targetPath] ?? 0) + 1
    }
  }
  return counts
}

/**
 * The checkbox lines that carry `#tag` on their own line (organization
 * point 4): a tagged task is a row of that tag's database, wherever it was
 * written. Open rows first, in document order per note (most recently
 * edited note first); done rows after. Templates are left out like every
 * task read. The JSON column is matched by its exact quoted key, so a
 * `#lead` line never answers `#leader`.
 */
export async function getTasksForTag(tag: string): Promise<OpenTask[]> {
  const key = JSON.stringify(foldTag(tag))
  const rows = await taskRowsQuery()
    .where(sql<SqlBool>`instr(${sql.ref('tasks.tags')}, ${key}) > 0`)
    .orderBy('tasks.checked')
    .orderBy('notes.updatedAt', 'desc')
    .orderBy('tasks.notePath')
    .orderBy('tasks.markerOffset')
    .execute()
  return rows.map(toTaskRow)
}
