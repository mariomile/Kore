/**
 * The workspace's one line diff: the history "Changes" view and the chat
 * patch card render it, and sync's note merge builds a three-way merge on
 * it. Myers' O(ND) shortest edit script, after trimming the common prefix
 * and suffix, which is all an ordinary edit leaves.
 */

/** One change: lines `[start, end)` of the old text became `lines`. */
export interface LineHunk {
  readonly start: number
  readonly end: number
  readonly lines: readonly string[]
}

/**
 * Past this many differing lines the search stops and the whole trimmed
 * middle becomes one hunk: still a correct diff, just not a minimal one.
 */
const MAX_EDIT_DISTANCE = 4000

/** The changes turning `before` into `after`, disjoint and in order. */
export function lineHunks(before: readonly string[], after: readonly string[]): LineHunk[] {
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix++
  }
  let suffix = 0
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix++
  }
  const a = before.slice(prefix, before.length - suffix)
  const b = after.slice(prefix, after.length - suffix)
  if (a.length === 0 && b.length === 0) {
    return []
  }
  const matches = myersMatches(a, b) ?? []
  // Every gap between two matched pairs is one hunk.
  const hunks: LineHunk[] = []
  let i = 0
  let j = 0
  for (const [mi, mj] of [...matches, [a.length, b.length] as const]) {
    if (mi > i || mj > j) {
      hunks.push({ start: prefix + i, end: prefix + mi, lines: b.slice(j, mj) })
    }
    i = mi + 1
    j = mj + 1
  }
  return hunks
}

/** Matched index pairs of a shortest edit script, or `null` past the cap. */
function myersMatches(
  a: readonly string[],
  b: readonly string[],
): (readonly [number, number])[] | null {
  const n = a.length
  const m = b.length
  const max = Math.min(n + m, MAX_EDIT_DISTANCE)
  const offset = max + 1
  const v = new Int32Array(2 * max + 3)
  const at = (frontier: Int32Array, k: number): number => frontier[offset + k] ?? 0
  const movesDown = (frontier: Int32Array, k: number, d: number): boolean =>
    k === -d || (k !== d && at(frontier, k - 1) < at(frontier, k + 1))

  const trace: Int32Array[] = []
  let found = false
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x = movesDown(v, k, d) ? at(v, k + 1) : at(v, k - 1) + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[offset + k] = x
      if (x >= n && y >= m) {
        found = true
        break
      }
    }
  }
  if (!found) {
    return null
  }
  // Walk the saved frontiers back from the end, collecting diagonal runs.
  const matches: (readonly [number, number])[] = []
  let x = n
  let y = m
  for (let d = trace.length - 1; d >= 0; d--) {
    const frontier = trace[d] ?? v
    const k = x - y
    const prevK = movesDown(frontier, k, d) ? k + 1 : k - 1
    const prevX = d === 0 ? 0 : at(frontier, prevK)
    const prevY = d === 0 ? 0 : prevX - prevK
    while (x > prevX && y > prevY) {
      x--
      y--
      matches.push([x, y])
    }
    x = prevX
    y = prevY
  }
  return matches.reverse()
}
