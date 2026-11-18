import { addDaysIso, isIsoDate, parseIsoUtc, weekdayIso } from '@kore/utils'
import type { CollectionEntry, CollectionValue, TagProperty, TimelineZoom } from '@kore/core'

/**
 * The geometry of a collection's timeline (a Gantt-like view): which date
 * fields bound each bar, where each note's bar starts and how many days it
 * spans, and the window of days the view lays out. Pure, so the Mac and the
 * iPhone timelines place every note on the same days.
 */

/** The date fields a timeline reads: where a bar starts, and where it ends. */
export interface TimelineFields {
  readonly start: TagProperty
  /** `null` = every bar is a single day (a milestone). */
  readonly end: TagProperty | null
}

/** One note's bar: its first day and how many days it covers (≥ 1). */
export interface TimelineSpan {
  readonly start: string
  readonly end: string
  readonly days: number
}

export interface TimelineBar {
  readonly entry: CollectionEntry
  readonly span: TimelineSpan
  /** Day index of the bar's first day inside the window. */
  readonly offset: number
}

export interface TimelineWindow {
  /** First day laid out. */
  readonly start: string
  /** Number of days laid out. */
  readonly days: number
}

const START_KEY = /^(?:start|starts|begin|from|inizio|dal|kickoff)\b/i
const END_KEY = /^(?:end|ends|finish|to|until|fine|al|due|deadline|scadenza)\b/i

/**
 * The fields a timeline places bars by. Named keys win (`start` / `end`,
 * a saved view's own pick, an imported base's `start: note.start`), then
 * the schema's own wording (`Start`, `Due`, `Deadline`), then order: the
 * first date opens a bar and the next one closes it. `null` without a date.
 */
export function timelineFieldsOf(
  properties: readonly TagProperty[],
  preferred: { readonly start?: string | undefined; readonly end?: string | undefined } = {},
): TimelineFields | null {
  const dates = properties.filter((property) => property.type === 'date')
  const byKey = (key: string | undefined): TagProperty | undefined =>
    key === undefined ? undefined : dates.find((property) => property.key === key)
  const named = (pattern: RegExp, except?: TagProperty): TagProperty | undefined =>
    dates.find(
      (property) =>
        property !== except && (pattern.test(property.key) || pattern.test(property.name)),
    )
  const start = byKey(preferred.start) ?? named(START_KEY) ?? dates[0]
  if (start === undefined) {
    return null
  }
  const end =
    byKey(preferred.end) ??
    named(END_KEY, start) ??
    dates.find((property, index) => property !== start && index > dates.indexOf(start)) ??
    null
  return { start, end: end === start ? null : end }
}

/** The ISO day a date value holds (`2026-11-17`, or a datetime's day). */
function dayOf(value: CollectionValue | undefined): string | null {
  if (value === undefined || value.valueType !== 'string') {
    return null
  }
  const day = value.value.slice(0, 10)
  return isIsoDate(day) ? day : null
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseIsoUtc(to).getTime() - parseIsoUtc(from).getTime()) / 86_400_000)
}

/**
 * Where a note's bar sits. A missing or unreadable end, or one before the
 * start, makes a one-day bar; a note with only an end sits on that day.
 */
export function timelineSpanOf(
  entry: CollectionEntry,
  fields: TimelineFields,
): TimelineSpan | null {
  const startDay = dayOf(entry.properties[fields.start.key])
  const endDay = fields.end === null ? null : dayOf(entry.properties[fields.end.key])
  const first = startDay ?? endDay
  if (first === null) {
    return null
  }
  const last = endDay !== null && endDay >= first ? endDay : first
  return { start: first, end: last, days: daysBetween(first, last) + 1 }
}

/** Days of margin the window keeps around the bars and today, per zoom. */
const MARGIN_DAYS: Record<TimelineZoom, number> = { week: 14, month: 45, quarter: 120 }

/** Pixel width of one day at each zoom. */
export const TIMELINE_DAY_WIDTH: Record<TimelineZoom, number> = {
  week: 44,
  month: 18,
  quarter: 6,
}

/**
 * The days the view lays out: from the earliest bar (or today) to the
 * latest (or today), padded by the zoom's margin and snapped to whole weeks
 * so the header's week ticks line up with the first column.
 */
export function timelineWindowOf(
  spans: readonly TimelineSpan[],
  today: string,
  zoom: TimelineZoom,
  weekStart: number,
): TimelineWindow {
  let first = today
  let last = today
  for (const span of spans) {
    if (span.start < first) {
      first = span.start
    }
    if (span.end > last) {
      last = span.end
    }
  }
  const margin = MARGIN_DAYS[zoom]
  const padded = addDaysIso(first, -margin)
  const start = addDaysIso(padded, -((weekdayIso(padded) - weekStart + 7) % 7))
  const days = daysBetween(start, addDaysIso(last, margin)) + 1
  return { start, days: Math.ceil(days / 7) * 7 }
}

/** Every dated entry's bar (in the entries' order), their spans, and the undated count. */
export function timelineBarsOf(
  entries: readonly CollectionEntry[],
  fields: TimelineFields,
): { readonly bars: TimelineBar[]; readonly undated: number; readonly spans: TimelineSpan[] } {
  const bars: TimelineBar[] = []
  const spans: TimelineSpan[] = []
  for (const entry of entries) {
    const span = timelineSpanOf(entry, fields)
    if (span !== null) {
      spans.push(span)
      bars.push({ entry, span, offset: 0 })
    }
  }
  return { bars, undated: entries.length - bars.length, spans }
}

/** The bars placed inside `window` (their `offset` filled in). */
export function placeBars(bars: readonly TimelineBar[], window: TimelineWindow): TimelineBar[] {
  return bars.map((bar) => ({ ...bar, offset: daysBetween(window.start, bar.span.start) }))
}

/**
 * The new span after dragging a bar `deltaDays`: `move` shifts both ends,
 * `start` / `end` resize one edge without crossing the other.
 */
export function shiftSpan(
  span: TimelineSpan,
  edge: 'move' | 'start' | 'end',
  deltaDays: number,
): TimelineSpan {
  let start = span.start
  let end = span.end
  if (edge === 'move' || edge === 'start') {
    start = addDaysIso(span.start, deltaDays)
  }
  if (edge === 'move' || edge === 'end') {
    end = addDaysIso(span.end, deltaDays)
  }
  if (edge === 'start' && start > end) {
    start = end
  }
  if (edge === 'end' && end < start) {
    end = start
  }
  return { start, end, days: daysBetween(start, end) + 1 }
}

/** One month band of the header: its label and the days it covers in the window. */
export interface TimelineMonth {
  readonly key: string
  readonly label: string
  readonly offset: number
  readonly days: number
}

const MONTH_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})
const WEEKDAY_FORMAT = new Intl.DateTimeFormat(undefined, { weekday: 'narrow', timeZone: 'UTC' })

/** The window's month bands, clipped to the window's edges. */
export function timelineMonthsOf(window: TimelineWindow): TimelineMonth[] {
  const months: TimelineMonth[] = []
  let offset = 0
  while (offset < window.days) {
    const day = addDaysIso(window.start, offset)
    const date = parseIsoUtc(day)
    const daysInMonth = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
    ).getUTCDate()
    const span = Math.min(daysInMonth - date.getUTCDate() + 1, window.days - offset)
    months.push({
      key: day.slice(0, 7),
      label: MONTH_FORMAT.format(date),
      offset,
      days: span,
    })
    offset += span
  }
  return months
}

/** One labelled tick under the month bands. */
export interface TimelineTick {
  readonly day: string
  readonly offset: number
  /** The day of the month the tick shows. */
  readonly label: string
  /** A short weekday, shown only at the week zoom. */
  readonly weekday: string | null
  readonly weekend: boolean
}

/**
 * The header's ticks: every day at the week zoom, every week start at the
 * month and quarter zooms (a day there is too narrow for its number).
 */
export function timelineTicksOf(window: TimelineWindow, zoom: TimelineZoom): TimelineTick[] {
  const step = zoom === 'week' ? 1 : 7
  const ticks: TimelineTick[] = []
  for (let offset = 0; offset < window.days; offset += step) {
    const day = addDaysIso(window.start, offset)
    const weekday = weekdayIso(day)
    ticks.push({
      day,
      offset,
      label: String(Number(day.slice(8, 10))),
      weekday: zoom === 'week' ? WEEKDAY_FORMAT.format(parseIsoUtc(day)) : null,
      weekend: weekday === 0 || weekday === 6,
    })
  }
  return ticks
}
