import { differenceInCalendarDays, format, parse } from 'date-fns'
import type { DateFormat, TimeFormat } from '@reflect/core'

/**
 * The app's date layer (Plan 06). Daily notes are keyed by **local** calendar
 * dates as ISO `YYYY-MM-DD` strings — "today" follows the user's clock. Pure
 * calendar arithmetic (`addDaysIso`, `isIsoDate`) lives in `@reflect/utils` and
 * is re-exported here; this module owns the date-fns-backed *display* formatting
 * and the local clock. Nothing else in the app may compute dates by hand.
 */

// Pure calendar math is shared with the indexing layer — one implementation.
export { addDaysIso, isIsoDate } from '@reflect/utils'

const ISO_DATE_FORMAT = 'yyyy-MM-dd'

/** Parse an ISO `YYYY-MM-DD` string as a local Date (the one parsing path). */
export function parseIsoDate(date: string): Date {
  return parse(date, ISO_DATE_FORMAT, new Date())
}

/** Today's local calendar date as `YYYY-MM-DD`. */
export function todayIso(): string {
  return format(new Date(), ISO_DATE_FORMAT)
}

/**
 * Label for an ISO date per the user's date-format setting. `mdy` and `dmy`
 * keep the original app's daily-subject form (`Tue, June 9th, 2026` /
 * `Tue, 9th June, 2026`); `iso` renders the daily-note key itself.
 */
export function formatDayLabel(date: string, dateFormat: DateFormat): string {
  switch (dateFormat) {
    case 'dmy':
      return format(parseIsoDate(date), 'EEE, do MMMM, yyyy')
    case 'iso':
      return date
    case 'mdy':
      return format(parseIsoDate(date), 'EEE, MMMM do, yyyy')
  }
}

/**
 * The app's one compact date, for every place a date sits in a row, a cell,
 * a chip or a pill: `Jun 9` for `mdy`, `9 Jun` for `dmy`, gaining the year
 * only away from the current one (`Dec 31, 2025` / `31 Dec 2025`); `iso`
 * keeps the daily-note key (`2026-06-09`). Spelled-out months on purpose:
 * `6/9/2026` reads as two different days depending on who reads it.
 * `now` is injectable for tests.
 */
export function formatShortDate(
  date: string,
  dateFormat: DateFormat,
  now: Date = new Date(),
): string {
  return dateFormat === 'iso' ? date : shortDateOf(parseIsoDate(date), dateFormat, now)
}

function shortDateOf(date: Date, dateFormat: DateFormat, now: Date): string {
  if (dateFormat === 'iso') {
    return format(date, ISO_DATE_FORMAT)
  }
  const sameYear = date.getFullYear() === now.getFullYear()
  if (dateFormat === 'dmy') {
    return format(date, sameYear ? 'd MMM' : 'd MMM yyyy')
  }
  return format(date, sameYear ? 'MMM d' : 'MMM d, yyyy')
}

/**
 * A date label per the date-format setting: `June 10th, 2026` for `mdy`,
 * `10th June, 2026` for `dmy`, and `2026-06-10` for `iso` (the forms the
 * settings screen shows as the options themselves).
 */
export function formatFullDate(date: Date, dateFormat: DateFormat): string {
  switch (dateFormat) {
    case 'dmy':
      return format(date, 'do MMMM, yyyy')
    case 'iso':
      return format(date, ISO_DATE_FORMAT)
    case 'mdy':
      return format(date, 'MMMM do, yyyy')
  }
}

/**
 * A time of day per the user's time-format setting: `8:22pm` for `12h`,
 * `20:22` for `24h`. Every time the app displays goes through this.
 */
export function formatTimeOfDay(date: Date, timeFormat: TimeFormat): string {
  return format(date, timeFormat === '24h' ? 'HH:mm' : 'h:mmaaa')
}

/**
 * The display-format preferences the date/time formatters need — a structural
 * subset of the settings document, so call sites can pass `settings` whole.
 */
export interface DateTimePrefs {
  timeFormat: TimeFormat
  dateFormat: DateFormat
}

/**
 * Recency label for list rows (Updated columns, history, chats): the time
 * today (per `timeFormat`), `Yesterday`, the weekday within the last week
 * (`Mon`), and the compact date of {@link formatShortDate} beyond that.
 * `now` is injectable for tests.
 */
export function formatRecencyLabel(
  epochMs: number,
  prefs: DateTimePrefs,
  now: Date = new Date(),
): string {
  const date = new Date(epochMs)
  const daysAgo = differenceInCalendarDays(now, date)
  if (daysAgo <= 0) {
    return formatTimeOfDay(date, prefs.timeFormat)
  }
  if (daysAgo === 1) {
    return 'Yesterday'
  }
  if (daysAgo < 7) {
    return format(date, 'EEE')
  }
  return shortDateOf(date, prefs.dateFormat, now)
}

/**
 * A moment with its time, for one-off events (a sync, an agent run): the
 * compact date and the time, `Jun 9, 8:22pm` / `9 Jun, 20:22`.
 */
export function formatDateTime(
  epochMs: number,
  prefs: DateTimePrefs,
  now: Date = new Date(),
): string {
  const date = new Date(epochMs)
  return `${shortDateOf(date, prefs.dateFormat, now)}, ${formatTimeOfDay(date, prefs.timeFormat)}`
}
