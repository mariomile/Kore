import { normalizeWikiTarget } from './resolve'
import type { WikiLink } from './model'

const DUE_TIME_RE = /^[ \t]*@(\d{1,2}):(\d{2})(?!\d)/

/**
 * A due-time suffix: optional spaces/tabs, then `@HH:MM` (24-hour). Used both
 * when extracting from a marker line and when splicing the suffix in edit
 * helpers, so parse and write never drift.
 */
export interface DueTimeMatch {
  /** Normalized `HH:MM`. */
  readonly time: string
  /** Length of the matched prefix, including leading whitespace. */
  readonly length: number
}

/**
 * Parse `@HH:MM` at the start of `text`. Single-digit hours are zero-padded;
 * impossible hours/minutes yield null.
 */
export function matchDueTimePrefix(text: string): DueTimeMatch | null {
  const match = DUE_TIME_RE.exec(text)
  if (match === null || match[1] === undefined || match[2] === undefined) {
    return null
  }
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) {
    return null
  }
  return {
    time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    length: match[0].length,
  }
}

/**
 * The task's due date and optional time: the first calendar-valid `[[YYYY-MM-DD]]`
 * link inside the marker line (file coords), plus `@HH:MM` immediately after that
 * link when present. Reuses {@link normalizeWikiTarget} so an impossible date
 * (`2026-02-31`) is not a due date — exactly the dailies the resolver recognises.
 * The search window is the marker line so `@14:30` after the date is included.
 */
export function firstDue(
  body: string,
  bodyOffset: number,
  wikiLinks: WikiLink[],
  from: number,
  to: number,
): { dueDate: string | null; dueTime: string | null } {
  for (const link of wikiLinks) {
    if (link.from >= from && link.from < to) {
      const { date } = normalizeWikiTarget(link.target)
      if (date !== undefined) {
        return { dueDate: date, dueTime: dueTimeAfterLink(body, bodyOffset, link.to, to) }
      }
    }
  }
  return { dueDate: null, dueTime: null }
}

function dueTimeAfterLink(
  body: string,
  bodyOffset: number,
  linkTo: number,
  taskTo: number,
): string | null {
  const localFrom = linkTo - bodyOffset
  const localTo = taskTo - bodyOffset
  if (localFrom < 0 || localFrom > body.length) {
    return null
  }
  const windowEnd = Math.min(body.length, Math.max(localFrom, localTo))
  return matchDueTimePrefix(body.slice(localFrom, windowEnd))?.time ?? null
}
