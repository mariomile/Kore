import { normalizeWikiTarget } from './resolve'
import { scanInlineWikiLinks } from './scan'
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
 * A due date (and optional time) in task syntax, `[[2026-11-09]] @15:00`: the
 * form {@link firstDue} reads back.
 */
export function formatTaskDue(date: string, time: string | null): string {
  return time === null ? `[[${date}]]` : `[[${date}]] @${time}`
}

/**
 * What may follow a due-date link on its line: a time (even an impossible one,
 * which is then ignored as a time), then only the other task stamps
 * Kore writes or reads (`@repeat(...)`, `#tags`, `[[Project]]` links, a
 * `^block-id`), and a CRLF line's `\r`. Anything else after the date means it
 * is part of the sentence.
 */
const DUE_TAIL_RE =
  /^(?:[ \t]*@\d{1,2}:\d{2})?(?:[ \t]+(?:@repeat\([^)\n]*\)|#[^\s#]+|\[\[[^\]\n]+\]\]|\^[A-Za-z0-9-]+))*[ \t\r]*$/

/**
 * What may precede a due-date link written first: the line start or the task's
 * `[ ]` marker, then an optional `!`/`!!` priority.
 */
const DUE_LEAD_RE = /(?:^|\[[ x]\])[ \t]*(?:!{1,2}[ \t]+)?$/i

/**
 * Whether the date link at `[from, to)` in `text` is the task's due stamp
 * rather than a date mentioned mid-sentence: it carries an `@HH:MM` time, or it
 * ends its line (give or take the stamps in {@link DUE_TAIL_RE}), or opens it.
 * "Ship it [[2026-11-20]]" is due on the 20th; "Source: [[2026-09-13]]." and
 * "agreed on [[2026-09-13]] with Ana" only link the daily note, so a citation
 * never turns a task overdue.
 */
function isDueStampAt(text: string, from: number, to: number): boolean {
  const lineStart = text.lastIndexOf('\n', from - 1) + 1
  const newline = text.indexOf('\n', to)
  const lineEnd = newline === -1 ? text.length : newline
  const after = text.slice(to, lineEnd)
  return (
    matchDueTimePrefix(after) !== null ||
    DUE_TAIL_RE.test(after) ||
    DUE_LEAD_RE.test(text.slice(lineStart, from))
  )
}

/**
 * The due-date link in a task's content (the markdown after the marker): the
 * first calendar-valid `[[YYYY-MM-DD]]` that sits in due-stamp position (see
 * {@link isDueStampAt}). The single rule the projection, the edit helpers and
 * repeats share.
 */
export function dueDateLinkInContent(
  content: string,
): { date: string; from: number; to: number } | undefined {
  for (const link of scanInlineWikiLinks(content)) {
    const { date } = normalizeWikiTarget(link.target)
    if (date !== undefined && isDueStampAt(content, link.from, link.to)) {
      return { date, from: link.from, to: link.to }
    }
  }
  return undefined
}

/**
 * The task's due date and optional time: the first calendar-valid `[[YYYY-MM-DD]]`
 * link inside the task span (file coords) in due-stamp position (see
 * {@link isDueStampAt}), plus `@HH:MM` immediately after that link when present.
 * Reuses {@link normalizeWikiTarget} so an impossible date (`2026-02-31`) is not a
 * due date — exactly the dailies the resolver recognises. The search window is
 * the task's full span (marker line plus continuation lines) so a date on a
 * wrapped line, and `@14:30` after the date, count.
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
      if (date !== undefined && isDueStampAt(body, link.from - bodyOffset, link.to - bodyOffset)) {
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
