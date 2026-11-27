import type { Span } from './model'

/**
 * Plain-text rendering (Plan 03): turn a slice of markdown body into the text a
 * reader sees — emphasis/marker syntax dropped, wiki brackets/pipes flattened,
 * backslash escapes resolved, code spans kept literal. Shared by {@link parseNote}
 * for the whole-body FTS/AI text and by each task's display text, so a task
 * renders exactly as the note's body does.
 *
 * The walk in `extract.ts` supplies two span sets in body coordinates: `cuts`
 * (syntax ranges to drop — `*emphasis*` marks, the `[ ]` TaskMarker, URLs) and
 * `literalRanges` (code regions whose backslashes stay verbatim). This module is
 * pure string surgery over those spans; it does no parsing of its own.
 */

/**
 * A syntax range dropped from plain text. Most cuts close up (`**bold**ly`
 * reads `boldly`); a cut with `text` leaves that in its place: a space for
 * syntax that separates words (a table's `|` between two cells, a `---` rule
 * between two blocks, so `|a|b|` reads `a b`, never `ab`), or a whole
 * rendering (a table as `Stage: Seed · Founded: 2021`). A cut that lies
 * inside an earlier one is swallowed with it, text and all.
 */
export interface Cut extends Span {
  text?: string
}

/** The `text` of a cut that only parts two words. */
export const WORD_BREAK = ' '

// Inner of a wiki link, for plain-text rendering.
const WIKI_INNER_RE = /\[\[([^\]\n]*)\]\]/g
// CommonMark backslash escapes are visible in source, but not rendered text.
const MARKDOWN_ESCAPE_RE = /\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g

/** Resolve CommonMark backslash escapes (`\*` → `*`). */
export function unescapeMarkdownText(text: string): string {
  return text.replaceAll(MARKDOWN_ESCAPE_RE, '$1')
}

function renderMarkdownText(text: string): string {
  return text
    .replaceAll(WIKI_INNER_RE, (_, inner: string) => inner.replaceAll('|', ' '))
    .replaceAll(MARKDOWN_ESCAPE_RE, '$1')
}

/**
 * A note's cuts and literal ranges, sorted once for the many
 * {@link plainTextOfRange} calls one body takes (every task line, breadcrumb
 * and table cell). Sorting per call made a note with a few thousand table
 * cells sort its every cut a few thousand times.
 */
export interface PlainTextSpans {
  readonly cuts: readonly Cut[]
  /** `cutReach[i]`: the furthest `to` among `cuts[0..i]`. */
  readonly cutReach: readonly number[]
  readonly literalRanges: readonly Span[]
  /** `literalReach[i]`: the furthest `to` among `literalRanges[0..i]`. */
  readonly literalReach: readonly number[]
}

function sortedWithReach<T extends Span>(spans: readonly T[]): { sorted: T[]; reach: number[] } {
  const sorted = [...spans].sort((a, b) => a.from - b.from)
  const reach: number[] = []
  let furthest = -1
  for (const span of sorted) {
    furthest = Math.max(furthest, span.to)
    reach.push(furthest)
  }
  return { sorted, reach }
}

export function plainTextSpans(
  cuts: readonly Cut[],
  literalRanges: readonly Span[],
): PlainTextSpans {
  const sortedCuts = sortedWithReach(cuts)
  const sortedLiterals = sortedWithReach(literalRanges)
  return {
    cuts: sortedCuts.sorted,
    cutReach: sortedCuts.reach,
    literalRanges: sortedLiterals.sorted,
    literalReach: sortedLiterals.reach,
  }
}

/**
 * The first index whose reach passes `pos`. Every span before it ends at or
 * before `pos`, so a walk from `pos` onward can start there. (Spans may nest,
 * so a span's own `to` is not sorted; its reach is.)
 */
function firstReaching(reach: readonly number[], pos: number): number {
  let low = 0
  let high = reach.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (reach[mid]! <= pos) {
      low = mid + 1
    } else {
      high = mid
    }
  }
  return low
}

function appendPlainTextChunk(
  body: string,
  from: number,
  to: number,
  spans: PlainTextSpans,
): string {
  const { literalRanges } = spans
  let kept = ''
  let cursor = from
  for (let i = firstReaching(spans.literalReach, from); i < literalRanges.length; i++) {
    const literalRange = literalRanges[i]!
    if (literalRange.to <= cursor) {
      continue
    }
    if (literalRange.from >= to) {
      break
    }

    const literalFrom = Math.max(cursor, literalRange.from)
    const literalTo = Math.min(to, literalRange.to)
    if (cursor < literalFrom) {
      kept += renderMarkdownText(body.slice(cursor, literalFrom))
    }
    kept += body.slice(literalFrom, literalTo)
    cursor = literalTo
  }
  if (cursor < to) {
    kept += renderMarkdownText(body.slice(cursor, to))
  }
  return kept
}

/**
 * Plain text of `[start, end)` minus the cut (syntax) ranges, with wiki
 * brackets/pipes flattened. Shared by the whole-body plain text and per-task
 * text so a task renders exactly as the note's body does (emphasis marks and
 * the `[ ]` TaskMarker dropped, code kept literal).
 */
export function plainTextOfRange(
  body: string,
  start: number,
  end: number,
  spans: PlainTextSpans,
): string {
  const { cuts } = spans
  let kept = ''
  let pos = start
  for (let i = firstReaching(spans.cutReach, start); i < cuts.length; i++) {
    const cut = cuts[i]!
    if (cut.to <= start) {
      continue
    }
    if (cut.from >= end) {
      break
    }
    const cutFrom = Math.max(start, cut.from)
    if (cutFrom > pos) {
      kept += appendPlainTextChunk(body, pos, cutFrom, spans)
    }
    const cutTo = Math.min(end, cut.to)
    if (cutTo > pos) {
      kept += cut.text ?? ''
      pos = cutTo
    }
  }
  if (pos < end) {
    kept += appendPlainTextChunk(body, pos, end, spans)
  }
  return kept.replaceAll(/\s+/g, ' ').trim()
}

/** Body text minus the cut (syntax) ranges, with wiki brackets/pipes flattened. */
export function buildPlainText(
  body: string,
  cuts: readonly Cut[],
  literalRanges: readonly Span[],
): string {
  return plainTextOfRange(body, 0, body.length, plainTextSpans(cuts, literalRanges))
}
