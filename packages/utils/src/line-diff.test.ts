import { describe, expect, it } from 'vitest'
import { lineHunks, type LineHunk } from './line-diff'

/** Apply `hunks` to `before`; a correct diff always reproduces `after`. */
function apply(before: readonly string[], hunks: readonly LineHunk[]): string[] {
  const out: string[] = []
  let cursor = 0
  for (const hunk of hunks) {
    out.push(...before.slice(cursor, hunk.start), ...hunk.lines)
    cursor = hunk.end
  }
  return [...out, ...before.slice(cursor)]
}

describe('lineHunks', () => {
  it('finds nothing between equal texts', () => {
    expect(lineHunks(['a', 'b'], ['a', 'b'])).toEqual([])
  })

  it('reports a replacement, an insertion and a deletion as separate hunks', () => {
    expect(lineHunks(['a', 'b', 'c', 'd'], ['a', 'B', 'c', 'x', 'd'])).toEqual([
      { start: 1, end: 2, lines: ['B'] },
      { start: 3, end: 3, lines: ['x'] },
    ])
    expect(lineHunks(['a', 'b', 'c'], ['a', 'c'])).toEqual([{ start: 1, end: 2, lines: [] }])
  })

  it('always reproduces the new text, with a minimal script for random edits', () => {
    let seed = 11
    const random = (n: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed % n
    }
    for (let round = 0; round < 500; round++) {
      const before = Array.from({ length: random(40) }, () => `l${random(5)}`)
      const after = Array.from({ length: random(40) }, () => `l${random(5)}`)
      expect(apply(before, lineHunks(before, after))).toEqual(after)
    }
  })
})
