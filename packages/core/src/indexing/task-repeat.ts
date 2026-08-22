/**
 * Recurring tasks (Reflect Open extension). A task opts in with a repeat
 * token in its own markdown — `[ ] Water plants @repeat(weekly)` — so the
 * rule survives every round trip, syncs like any other text, and shows in
 * the editor. Completing such a task — from the Tasks view or by clicking
 * the in-editor checkbox — spawns the next occurrence: the same content
 * with its `[[YYYY-MM-DD]]` due-date link advanced by the interval
 * (appended when the task had no date yet).
 *
 * Accepted intervals: `daily` / `weekly` / `monthly` / `yearly`, or a count
 * with a unit letter — `@repeat(2w)`, `@repeat(10d)`, `@repeat(3m)`,
 * `@repeat(1y)`. Anything else is prose and spawns nothing.
 *
 * Lives in core (not the desktop view) so the same rules serve any surface,
 * matching the task-grouping module.
 */

import { parseNote } from '../markdown'

/** A parsed repeat rule: every N days/weeks/months/years. */
export interface TaskRepeat {
  every: number
  unit: 'day' | 'week' | 'month' | 'year'
}

const REPEAT_TOKEN_RE = /@repeat\(\s*([^()\s]+)\s*\)/i

const WORD_INTERVALS: Record<string, TaskRepeat> = {
  daily: { every: 1, unit: 'day' },
  weekly: { every: 1, unit: 'week' },
  monthly: { every: 1, unit: 'month' },
  yearly: { every: 1, unit: 'year' },
}

const UNIT_LETTERS: Record<string, TaskRepeat['unit']> = {
  d: 'day',
  w: 'week',
  m: 'month',
  y: 'year',
}

/** The repeat rule carried by a task's content, or null. */
export function taskContentRepeat(content: string): TaskRepeat | null {
  const match = REPEAT_TOKEN_RE.exec(content)
  if (match === null) {
    return null
  }
  const spec = match[1]!.toLowerCase()
  const word = WORD_INTERVALS[spec]
  if (word !== undefined) {
    return word
  }
  const counted = /^(\d{1,3})([dwmy])$/.exec(spec)
  if (counted === null) {
    return null
  }
  const every = Number(counted[1])
  if (every < 1) {
    return null
  }
  return { every, unit: UNIT_LETTERS[counted[2]!]! }
}

const DATE_LINK_RE = /\[\[(\d{4}-\d{2}-\d{2})\]\]/

/** The first `[[YYYY-MM-DD]]` link in a task's content, or null. */
export function taskContentDueDate(content: string): string | null {
  return DATE_LINK_RE.exec(content)?.[1] ?? null
}

function isoToUtc(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, day!))
}

function utcToIso(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, '0')
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDaysIso(iso: string, days: number): string {
  const date = isoToUtc(iso)
  date.setUTCDate(date.getUTCDate() + days)
  return utcToIso(date)
}

/** Month arithmetic that clamps the day (Jan 31 + 1 month → Feb 28/29). */
function addMonthsIso(iso: string, months: number): string {
  const [year, month, day] = iso.split('-').map(Number)
  const monthIndex = year! * 12 + (month! - 1) + months
  const targetYear = Math.floor(monthIndex / 12)
  const targetMonth = monthIndex - targetYear * 12
  const daysInTarget = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
  return utcToIso(new Date(Date.UTC(targetYear, targetMonth, Math.min(day!, daysInTarget))))
}

function advance(iso: string, repeat: TaskRepeat): string {
  switch (repeat.unit) {
    case 'day':
      return addDaysIso(iso, repeat.every)
    case 'week':
      return addDaysIso(iso, repeat.every * 7)
    case 'month':
      return addMonthsIso(iso, repeat.every)
    case 'year':
      return addMonthsIso(iso, repeat.every * 12)
  }
}

/** How many catch-up steps a long-dormant task may take before bailing out. */
const MAX_CATCH_UP_STEPS = 10_000

/**
 * The date the next occurrence lands on: the base advanced by the interval,
 * then advanced again until it is after `today` — completing a long-overdue
 * weekly task yields next week, not a stack of missed weeks.
 */
export function nextOccurrenceDate(base: string, repeat: TaskRepeat, today: string): string {
  let candidate = advance(base, repeat)
  for (let step = 0; candidate <= today && step < MAX_CATCH_UP_STEPS; step += 1) {
    candidate = advance(candidate, repeat)
  }
  return candidate
}

/**
 * The next occurrence's content: the first due-date link advanced (the base
 * being that link's date, else `today`), appended when the task had none.
 * The repeat token itself rides along unchanged, so the new task recurs too.
 */
export function nextOccurrenceContent(content: string, repeat: TaskRepeat, today: string): string {
  const due = taskContentDueDate(content)
  const next = nextOccurrenceDate(due ?? today, repeat, today)
  if (due !== null) {
    return content.replace(DATE_LINK_RE, `[[${next}]]`)
  }
  return `${content.trimEnd()} [[${next}]]`
}

/** Dummy path: extraction only needs a path for title/daily derivation, not tasks. */
const PARSE_PATH = 'notes/repeat.md'

/**
 * Task line content after the three-character `[ ]`/`[x]` marker. Matches the
 * desktop `taskContent` helper: one separating space or tab is stripped so
 * spawned lines don't pick up a double gap.
 */
function taskMarkerContent(raw: string): string {
  const rest = raw.slice(3)
  return rest[0] === ' ' || rest[0] === '\t' ? rest.slice(1) : rest
}

/**
 * Markdown task lines to append after `previousSource` became `nextSource` by
 * completing one or more `@repeat(...)` checkboxes and nothing else on those
 * lines. Empty when the change is a reopen, a content edit, a newly pasted
 * already-checked task, or a square GFM checkbox (which is not a Reflect task).
 *
 * Identity is `markerOffset` plus an identical rest-of-line, so deleting a
 * line above (which shifts later offsets) does not look like a completion.
 * `today` is the local calendar date (`YYYY-MM-DD`) the next occurrence
 * advances from when the completed task had no due-date link.
 */
export function nextOccurrenceAppends(
  previousSource: string,
  nextSource: string,
  today: string,
): string[] {
  if (previousSource === nextSource || !REPEAT_TOKEN_RE.test(previousSource)) {
    return []
  }
  const previousByOffset = new Map(
    parseNote({ path: PARSE_PATH, source: previousSource }).tasks.map((task) => [
      task.markerOffset,
      task,
    ]),
  )
  const appends: string[] = []
  for (const next of parseNote({ path: PARSE_PATH, source: nextSource }).tasks) {
    const previous = previousByOffset.get(next.markerOffset)
    if (previous === undefined || previous.checked || !next.checked) {
      continue
    }
    if (previous.raw.slice(3) !== next.raw.slice(3)) {
      continue
    }
    const content = taskMarkerContent(previous.raw)
    const repeat = taskContentRepeat(content)
    if (repeat === null) {
      continue
    }
    appends.push(`+ [ ] ${nextOccurrenceContent(content, repeat, today)}`)
  }
  return appends
}
