import { formatMoment } from '../markdown/template-placeholders'
import type { BaseDate } from './values'

/**
 * Date helpers for Bases: parsing frontmatter date strings, duration
 * literals (`"7d"`, `"2 weeks"`) and `date.format("YYYY-MM-DD")`. Local
 * time throughout, like Obsidian.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/

/** `2026-10-10`, `2026-10-10 14:30`, `2026-10-10T14:30:00`, or null. */
export function parseBaseDate(text: string): BaseDate | null {
  const match = DATE_RE.exec(text.trim())
  if (match === null) {
    return null
  }
  const [, year, month, day, hour, minute, second] = match
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour ?? 0),
    Number(minute ?? 0),
    Number(second ?? 0),
  )
  if (Number.isNaN(date.getTime()) || date.getDate() !== Number(day)) {
    return null
  }
  return { kind: 'date', ms: date.getTime(), time: hour !== undefined }
}

const DAY_MS = 86_400_000
const UNIT_MS: Record<string, number> = {
  s: 1000,
  second: 1000,
  m: 60_000,
  minute: 60_000,
  h: 3_600_000,
  hour: 3_600_000,
  d: DAY_MS,
  day: DAY_MS,
  w: 7 * DAY_MS,
  week: 7 * DAY_MS,
  M: 30 * DAY_MS,
  month: 30 * DAY_MS,
  y: 365 * DAY_MS,
  year: 365 * DAY_MS,
}

/** `"7d"`, `"1 week"`, `"3 months"` to milliseconds, or null. */
export function parseBaseDuration(text: string): number | null {
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*([a-z]+)\s*$/i.exec(text)
  if (match === null) {
    return null
  }
  const unit = match[2]!
  const ms = UNIT_MS[unit] ?? UNIT_MS[unit.toLowerCase().replace(/s$/, '')]
  return ms === undefined ? null : Number(match[1]) * ms
}

/** Format epoch ms with moment tokens, as `date.format("YYYY-MM-DD")` does. */
export function formatBaseDate(ms: number, format: string): string {
  return formatMoment(new Date(ms), format)
}
