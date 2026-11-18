/**
 * Weekly notes: one Markdown file per ISO week, `weekly/2026-W47.md`.
 *
 * The same shape Obsidian's Periodic Notes plugin writes with its
 * `GGGG-[W]WW` format, so a vault stays openable in Obsidian and any agent
 * can derive a week's file (and its seven dailies) from the date alone. A
 * week runs Monday to Sunday (ISO 8601) and belongs to the year that holds
 * its Thursday, so `2027-01-01` (a Friday) is in `2026-W53`.
 */

/** Graph-relative folder weekly notes live in. */
export const WEEKLY_FOLDER = 'weekly'

/** Template a new weekly note starts from, when the vault has one. */
export const WEEKLY_TEMPLATE = 'templates/weekly.md'

const WEEK_KEY_RE = /^(\d{4})-W(\d{2})$/
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** An ISO week: its key (`2026-W47`), number, and Monday-to-Sunday range. */
export interface IsoWeek {
  readonly key: string
  readonly year: number
  readonly week: number
  /** ISO date of the week's Monday. */
  readonly start: string
  /** ISO date of the week's Sunday. */
  readonly end: string
}

function utcDate(iso: string): Date {
  const match = ISO_DATE_RE.exec(iso)
  if (match === null) {
    throw new Error(`expected an ISO YYYY-MM-DD date, got: ${iso}`)
  }
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
}

function isoOf(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000)
}

function weekFromMonday(monday: Date): IsoWeek {
  const thursday = addDays(monday, 3)
  const year = thursday.getUTCFullYear()
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const firstMonday = addDays(jan4, -((jan4.getUTCDay() + 6) % 7))
  const week = Math.round((monday.getTime() - firstMonday.getTime()) / (7 * 86_400_000)) + 1
  return {
    key: `${year}-W${String(week).padStart(2, '0')}`,
    year,
    week,
    start: isoOf(monday),
    end: isoOf(addDays(monday, 6)),
  }
}

/** The ISO week an ISO `YYYY-MM-DD` date falls in. */
export function isoWeekOf(date: string): IsoWeek {
  const day = utcDate(date)
  return weekFromMonday(addDays(day, -((day.getUTCDay() + 6) % 7)))
}

/** The ISO week for a `2026-W47` key, or `null` when the key names no week. */
export function isoWeekFromKey(key: string): IsoWeek | null {
  const match = WEEK_KEY_RE.exec(key)
  if (match === null) {
    return null
  }
  const year = Number(match[1])
  const week = Number(match[2])
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const firstMonday = addDays(jan4, -((jan4.getUTCDay() + 6) % 7))
  const parsed = weekFromMonday(addDays(firstMonday, (week - 1) * 7))
  // `2026-W60` would roll into the next year: not a week of 2026.
  return parsed.key === key ? parsed : null
}

/**
 * The ISO week a calendar row belongs to, for any week-start setting: the
 * week of the row's Monday (`getDay()` numbering, as `weekStartDow`
 * returns). A Sunday- or Saturday-start row still opens one
 * Monday-to-Sunday note, the one holding most of the row's days.
 */
export function isoWeekOfCalendarRow(rowStart: string, weekStartsOn: 0 | 1 | 6): IsoWeek {
  const offsetToMonday = (8 - weekStartsOn) % 7
  return isoWeekOf(isoOf(addDays(utcDate(rowStart), offsetToMonday)))
}

/** The week `delta` weeks from `week` (negative goes back). */
export function addWeeks(week: IsoWeek, delta: number): IsoWeek {
  return isoWeekOf(isoOf(addDays(utcDate(week.start), delta * 7)))
}

/** The seven ISO dates of a week, Monday first. */
export function daysOfWeek(week: IsoWeek): string[] {
  const monday = utcDate(week.start)
  return Array.from({ length: 7 }, (_, index) => isoOf(addDays(monday, index)))
}

/** A weekly note's display title, its subject everywhere it is named: `Week 47`. */
export function weeklyNoteTitle(week: IsoWeek): string {
  return `Week ${week.week}`
}

/** Graph-relative path of a week's note. */
export function weeklyPath(week: IsoWeek | string): string {
  const key = typeof week === 'string' ? week : week.key
  if (isoWeekFromKey(key) === null) {
    throw new Error(`weeklyPath expects a YYYY-Www week key, got: ${key}`)
  }
  return `${WEEKLY_FOLDER}/${key}.md`
}

/** The week a path is the weekly note of, or `null` for any other path. */
export function weekFromWeeklyPath(path: string): IsoWeek | null {
  const prefix = `${WEEKLY_FOLDER}/`
  if (!path.startsWith(prefix) || !path.endsWith('.md')) {
    return null
  }
  return isoWeekFromKey(path.slice(prefix.length, -'.md'.length))
}

/** The weekly path pattern for prompts and docs. */
export function weeklyPathPattern(): string {
  return `${WEEKLY_FOLDER}/YYYY-Www.md`
}
