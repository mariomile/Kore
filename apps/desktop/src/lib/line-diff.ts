import { lineHunks } from '@kore/utils'

/**
 * Line diff for the note-history "Changes" view and the chat patch card, as
 * display rows over the shared `lineHunks` diff.
 */

export interface DiffLine {
  kind: 'same' | 'added' | 'removed'
  text: string
}

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
 * `same`, and each change as its `removed` lines followed by its `added` ones.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const beforeLines = splitLines(before)
  const result: DiffLine[] = []
  let cursor = 0
  for (const hunk of lineHunks(beforeLines, splitLines(after))) {
    result.push(
      ...beforeLines.slice(cursor, hunk.start).map((text) => ({ kind: 'same', text }) as const),
      ...beforeLines
        .slice(hunk.start, hunk.end)
        .map((text) => ({ kind: 'removed', text }) as const),
      ...hunk.lines.map((text) => ({ kind: 'added', text }) as const),
    )
    cursor = hunk.end
  }
  result.push(...beforeLines.slice(cursor).map((text) => ({ kind: 'same', text }) as const))
  return result
}
