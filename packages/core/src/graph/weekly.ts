/**
 * Weekly notes: one Markdown file per ISO week, `weekly/2026-W47.md`.
 *
 * The same shape Obsidian's Periodic Notes plugin writes with its
 * `GGGG-[W]WW` format, so a vault stays openable in Obsidian and any agent
 * can derive a week's file (and its seven dailies) from the date alone. A
 * week runs Monday to Sunday (ISO 8601) and belongs to the year that holds
 * its Thursday, so `2027-01-01` (a Friday) is in `2026-W53`.
 */

import { addDaysIso, isoFromParts, parseIsoUtc, weekdayIso } from '@kore/utils'

/** Graph-relative folder weekly notes live in. */
export const WEEKLY_FOLDER = 'weekly'

/** Template a new weekly note starts from, when the vault has one. */
export const WEEKLY_TEMPLATE = 'templates/weekly.md'

const WEEK_KEY_RE = /^(\d{4})-W(\d{2})$/
const DAY_MS = 86_400_000

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

/** The Monday on or before an ISO date. */
function mondayOf(date: string): string {
  return addDaysIso(date, -((weekdayIso(date) + 6) % 7))
}

/** The Monday of an ISO year's first week: the week that holds January 4th. */
function firstMondayOfIsoYear(year: number): string {
  return mondayOf(isoFromParts(year, 1, 4))
}

function weekFromMonday(monday: string): IsoWeek {
  // A week belongs to the year that holds its Thursday.
  const year = Number(addDaysIso(monday, 3).slice(0, 4))
  const days =
    (parseIsoUtc(monday).getTime() - parseIsoUtc(firstMondayOfIsoYear(year)).getTime()) / DAY_MS
  const week = Math.round(days / 7) + 1
  return {
    key: `${year}-W${String(week).padStart(2, '0')}`,
    year,
    week,
    start: monday,
    end: addDaysIso(monday, 6),
  }
}

/** The ISO week an ISO `YYYY-MM-DD` date falls in. */
export function isoWeekOf(date: string): IsoWeek {
  return weekFromMonday(mondayOf(date))
}

/** Is an ISO date the first day (Monday) of its ISO week? */
export function isIsoWeekStart(date: string): boolean {
  return weekdayIso(date) === 1
}

/** The ISO week for a `2026-W47` key, or `null` when the key names no week. */
export function isoWeekFromKey(key: string): IsoWeek | null {
  const match = WEEK_KEY_RE.exec(key)
  if (match === null) {
    return null
  }
  const parsed = weekFromMonday(
    addDaysIso(firstMondayOfIsoYear(Number(match[1])), (Number(match[2]) - 1) * 7),
  )
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
  return isoWeekOf(addDaysIso(rowStart, (8 - weekStartsOn) % 7))
}

/** The week `delta` weeks from `week` (negative goes back). */
export function addWeeks(week: IsoWeek, delta: number): IsoWeek {
  return weekFromMonday(addDaysIso(week.start, delta * 7))
}

/** The seven ISO dates of a week, Monday first. */
export function daysOfWeek(week: IsoWeek): string[] {
  return Array.from({ length: 7 }, (_, index) => addDaysIso(week.start, index))
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
