/**
 * Line diff for the note-history "Changes" view: a plain LCS over lines,
 * with the common prefix/suffix trimmed first so ordinary edits (one section
 * of a long note) stay cheap. No dependency — history is a local feature and
 * the diff is presentational, not a merge input.
 */

export interface DiffLine {
  kind: 'same' | 'added' | 'removed'
  text: string
}

/** Above this many changed-region lines per side, skip the LCS (see below). */
const MAX_LCS_LINES = 3000

function splitLines(text: string): string[] {
  const lines = text.split('\n')
  // A trailing newline produces one phantom empty line — drop it so "ends
  // with newline" doesn't read as a changed last line.
  if (lines.at(-1) === '') {
    lines.pop()
  }
  return lines
}

/**
 * The diff from `before` to `after`, in display order: unchanged lines as
 * `same`, `before`-only lines as `removed`, `after`-only lines as `added`.
 * Beyond {@link MAX_LCS_LINES} changed lines per side the middle degrades to
 * one removed block followed by one added block (quadratic LCS would stall).
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const beforeLines = splitLines(before)
  const afterLines = splitLines(after)

  let prefix = 0
  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1
  }
  let suffix = 0
  while (
    suffix < beforeLines.length - prefix &&
    suffix < afterLines.length - prefix &&
    beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) {
    suffix += 1
  }

  const result: DiffLine[] = beforeLines
    .slice(0, prefix)
    .map((text) => ({ kind: 'same', text }) as const)
  const beforeMiddle = beforeLines.slice(prefix, beforeLines.length - suffix)
  const afterMiddle = afterLines.slice(prefix, afterLines.length - suffix)

  if (beforeMiddle.length > MAX_LCS_LINES || afterMiddle.length > MAX_LCS_LINES) {
    result.push(
      ...beforeMiddle.map((text) => ({ kind: 'removed', text }) as const),
      ...afterMiddle.map((text) => ({ kind: 'added', text }) as const),
    )
  } else {
    result.push(...lcsDiff(beforeMiddle, afterMiddle))
  }

  result.push(
    ...beforeLines
      .slice(beforeLines.length - suffix)
      .map((text) => ({ kind: 'same', text }) as const),
  )
  return result
}

/** Classic LCS table walk over the trimmed middle. */
function lcsDiff(before: string[], after: string[]): DiffLine[] {
  const rows = before.length + 1
  const cols = after.length + 1
  const table = new Uint32Array(rows * cols)
  const at = (row: number, col: number): number => table[row * cols + col] ?? 0
  for (let row = before.length - 1; row >= 0; row -= 1) {
    for (let col = after.length - 1; col >= 0; col -= 1) {
      table[row * cols + col] =
        before[row] === after[col]
          ? at(row + 1, col + 1) + 1
          : Math.max(at(row + 1, col), at(row, col + 1))
    }
  }
  const result: DiffLine[] = []
  let row = 0
  let col = 0
  while (row < before.length && col < after.length) {
    const beforeLine = before[row] ?? ''
    const afterLine = after[col] ?? ''
    if (beforeLine === afterLine) {
      result.push({ kind: 'same', text: beforeLine })
      row += 1
      col += 1
    } else if (at(row + 1, col) >= at(row, col + 1)) {
      result.push({ kind: 'removed', text: beforeLine })
      row += 1
    } else {
      result.push({ kind: 'added', text: afterLine })
      col += 1
    }
  }
  for (; row < before.length; row += 1) {
    result.push({ kind: 'removed', text: before[row] ?? '' })
  }
  for (; col < after.length; col += 1) {
    result.push({ kind: 'added', text: after[col] ?? '' })
  }
  return result
}
