import { parse as parseYaml } from 'yaml'
import { detectConflictMarkers } from '../markdown/conflict-markers'
import { splitFrontmatter } from '../markdown/frontmatter'

/**
 * A Markdown-aware three-way merge for notes that two devices edited
 * between syncs. Git's line merge flags as conflicts several edits that
 * can both be kept:
 *
 * - **Both devices appended** at the same spot (the daily-note case): git
 *   sees two insertions at one point and gives up. Here both are kept,
 *   this device's lines first.
 * - **Edits on neighbouring lines** (two properties next to each other,
 *   two adjacent tasks): git treats touching hunks as one conflict. Here
 *   only edits to the *same* lines conflict.
 * - **The same edit on both devices** merges to that edit.
 *
 * Anything else (the same lines changed two different ways, an edit
 * against a deletion) is a real conflict: the function returns `null` and
 * the caller keeps the conflict markers for the user to review. So does a
 * merge that would produce broken frontmatter (a property added on both
 * devices with different values, YAML that no longer parses).
 */
export function mergeNoteText(base: string, ours: string, theirs: string): string | null {
  if (ours === theirs) {
    return ours
  }
  if (detectConflictMarkers(ours) || detectConflictMarkers(theirs)) {
    return null // an earlier conflict is still unresolved; don't bury it
  }
  const merged = mergeLines(base.split('\n'), ours.split('\n'), theirs.split('\n'))
  if (merged === null) {
    return null
  }
  const text = merged.join('\n')
  return frontmatterIsSound(text, ours, theirs) ? text : null
}

/** A change one side made: base lines `[start, end)` became `lines`. */
interface Hunk {
  readonly start: number
  readonly end: number
  readonly lines: readonly string[]
}

/** Beyond this many differing lines the merge declines (keeps the markers). */
const MAX_EDIT_DISTANCE = 4000

function mergeLines(base: string[], ours: string[], theirs: string[]): string[] | null {
  const ourHunks = diffHunks(base, ours)
  const theirHunks = diffHunks(base, theirs)
  if (ourHunks === null || theirHunks === null) {
    return null
  }
  const tagged = [
    ...ourHunks.map((hunk) => ({ hunk, side: 'ours' as const })),
    ...theirHunks.map((hunk) => ({ hunk, side: 'theirs' as const })),
  ].sort((a, b) => a.hunk.start - b.hunk.start || a.hunk.end - b.hunk.end)

  const out: string[] = []
  let cursor = 0
  let index = 0
  while (index < tagged.length) {
    const first = tagged[index]
    if (first === undefined) {
      break
    }
    let lo = first.hunk.start
    let hi = first.hunk.end
    const group = [first]
    index++
    for (let next = tagged[index]; next !== undefined; next = tagged[index]) {
      if (!overlaps(lo, hi, next.hunk)) {
        break
      }
      group.push(next)
      lo = Math.min(lo, next.hunk.start)
      hi = Math.max(hi, next.hunk.end)
      index++
    }
    const mine = group.filter((entry) => entry.side === 'ours').map((entry) => entry.hunk)
    const other = group.filter((entry) => entry.side === 'theirs').map((entry) => entry.hunk)
    const resolved = resolveGroup(base, lo, hi, mine, other)
    if (resolved === null) {
      return null
    }
    out.push(...base.slice(cursor, lo), ...resolved)
    cursor = hi
  }
  out.push(...base.slice(cursor))
  return out
}

/**
 * Whether `hunk` touches the group spanning base `[lo, hi)`. Changes that
 * merely sit next to each other don't; two insertions at one point do, and
 * so does an insertion strictly inside a changed range.
 */
function overlaps(lo: number, hi: number, hunk: Hunk): boolean {
  const groupIsInsertion = lo === hi
  const hunkIsInsertion = hunk.start === hunk.end
  if (groupIsInsertion && hunkIsInsertion) {
    return hunk.start === lo
  }
  if (groupIsInsertion) {
    return hunk.start < lo && lo < hunk.end
  }
  if (hunkIsInsertion) {
    return lo < hunk.start && hunk.start < hi
  }
  return hunk.start < hi && hunk.end > lo
}

function resolveGroup(
  base: readonly string[],
  lo: number,
  hi: number,
  mine: readonly Hunk[],
  other: readonly Hunk[],
): readonly string[] | null {
  const ourText = applyHunks(base, lo, hi, mine)
  const theirText = applyHunks(base, lo, hi, other)
  if (other.length === 0) {
    return ourText
  }
  if (mine.length === 0 || sameLines(ourText, theirText)) {
    return theirText
  }
  if (lo === hi) {
    return [...ourText, ...theirText] // both appended here: keep both
  }
  return null
}

/** One side's version of base `[lo, hi)`, given its hunks inside that range. */
function applyHunks(
  base: readonly string[],
  lo: number,
  hi: number,
  hunks: readonly Hunk[],
): string[] {
  const out: string[] = []
  let cursor = lo
  for (const hunk of hunks) {
    out.push(...base.slice(cursor, hunk.start), ...hunk.lines)
    cursor = hunk.end
  }
  out.push(...base.slice(cursor, hi))
  return out
}

function sameLines(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((line, i) => line === b[i])
}

/**
 * The changes turning `a` into `b`, as disjoint hunks in base order, or
 * `null` when the edit is too large to merge with confidence. Myers'
 * O(ND) diff after trimming the common prefix and suffix, which is all a
 * typical two-device edit leaves.
 */
function diffHunks(a: readonly string[], b: readonly string[]): Hunk[] | null {
  let prefix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
    prefix++
  }
  let suffix = 0
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++
  }
  const midA = a.slice(prefix, a.length - suffix)
  const midB = b.slice(prefix, b.length - suffix)
  const matches = myersMatches(midA, midB)
  if (matches === null) {
    return null
  }
  // Walk the matched pairs; every gap between two matches is one hunk.
  const hunks: Hunk[] = []
  let i = 0
  let j = 0
  for (const [mi, mj] of [...matches, [midA.length, midB.length] as const]) {
    if (mi > i || mj > j) {
      hunks.push({
        start: prefix + i,
        end: prefix + mi,
        lines: midB.slice(j, mj),
      })
    }
    i = mi + 1
    j = mj + 1
  }
  return hunks
}

/** Matched index pairs of a shortest edit script from `a` to `b`. */
function myersMatches(
  a: readonly string[],
  b: readonly string[],
): (readonly [number, number])[] | null {
  const n = a.length
  const m = b.length
  const max = Math.min(n + m, MAX_EDIT_DISTANCE)
  const offset = max + 1
  const v = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  let found = n === 0 && m === 0
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0))
      let x = down ? (v[offset + k + 1] ?? 0) : (v[offset + k - 1] ?? 0) + 1
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
  // Backtrack through the saved frontiers, collecting the diagonal moves.
  const matches: (readonly [number, number])[] = []
  let x = n
  let y = m
  for (let d = trace.length - 1; d >= 0; d--) {
    const frontier = trace[d]
    if (frontier === undefined) {
      break
    }
    const k = x - y
    const down =
      k === -d || (k !== d && (frontier[offset + k - 1] ?? 0) < (frontier[offset + k + 1] ?? 0))
    const prevK = down ? k + 1 : k - 1
    const prevX = d === 0 ? 0 : (frontier[offset + prevK] ?? 0)
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

/**
 * The merged note's frontmatter must be as sound as both inputs': every
 * top-level property once, and YAML that still parses.
 */
function frontmatterIsSound(merged: string, ours: string, theirs: string): boolean {
  const raw = splitFrontmatter(merged).raw
  if (raw === null) {
    return true
  }
  const keys = topLevelKeys(raw)
  if (new Set(keys).size !== keys.length) {
    return false
  }
  return parses(raw) || !parses(splitFrontmatter(ours).raw) || !parses(splitFrontmatter(theirs).raw)
}

function topLevelKeys(raw: string): string[] {
  const keys: string[] = []
  for (const line of raw.split('\n')) {
    const match = /^([^\s#-][^:]*):(?:\s|$)/.exec(line)
    if (match?.[1] !== undefined) {
      keys.push(match[1].trim())
    }
  }
  return keys
}

function parses(raw: string | null): boolean {
  if (raw === null) {
    return true
  }
  try {
    parseYaml(raw)
    return true
  } catch {
    return false
  }
}
