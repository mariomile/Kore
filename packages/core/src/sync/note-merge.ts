import { lineHunks, type LineHunk } from '@kore/utils'
import { detectConflictMarkers } from '../markdown/conflict-markers'
import { parseFrontmatter, splitFrontmatter } from '../markdown/frontmatter'

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

function mergeLines(base: string[], ours: string[], theirs: string[]): string[] | null {
  const out: string[] = []
  let cursor = 0
  for (const group of changeGroups(base, ours, theirs)) {
    const resolved = resolveGroup(base, group)
    if (resolved === null) {
      return null
    }
    out.push(...base.slice(cursor, group.lo), ...resolved)
    cursor = group.hi
  }
  out.push(...base.slice(cursor))
  return out
}

/** Overlapping hunks of both sides, spanning base lines `[lo, hi)`. */
interface ChangeGroup {
  lo: number
  hi: number
  readonly ours: LineHunk[]
  readonly theirs: LineHunk[]
}

/** Both sides' hunks against `base`, clustered where they overlap, in base order. */
function changeGroups(base: string[], ours: string[], theirs: string[]): ChangeGroup[] {
  const tagged = [
    ...lineHunks(base, ours).map((hunk) => ({ hunk, side: 'ours' as const })),
    ...lineHunks(base, theirs).map((hunk) => ({ hunk, side: 'theirs' as const })),
  ].sort((a, b) => a.hunk.start - b.hunk.start || a.hunk.end - b.hunk.end)
  const groups: ChangeGroup[] = []
  for (const { hunk, side } of tagged) {
    const last = groups.at(-1)
    if (last !== undefined && overlaps(last.lo, last.hi, hunk)) {
      last.lo = Math.min(last.lo, hunk.start)
      last.hi = Math.max(last.hi, hunk.end)
      last[side].push(hunk)
    } else {
      const group: ChangeGroup = { lo: hunk.start, hi: hunk.end, ours: [], theirs: [] }
      group[side].push(hunk)
      groups.push(group)
    }
  }
  return groups
}

/**
 * Whether `hunk` touches the group spanning base `[lo, hi)`. Changes that
 * merely sit next to each other don't; two insertions at one point do, and
 * so does an insertion strictly inside a changed range.
 */
function overlaps(lo: number, hi: number, hunk: LineHunk): boolean {
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

function resolveGroup(base: readonly string[], group: ChangeGroup): readonly string[] | null {
  const { lo, hi } = group
  const ourText = applyHunks(base, lo, hi, group.ours)
  const theirText = applyHunks(base, lo, hi, group.theirs)
  if (group.theirs.length === 0) {
    return ourText
  }
  if (group.ours.length === 0 || sameLines(ourText, theirText)) {
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
  hunks: readonly LineHunk[],
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
 * The merged frontmatter must be as sound as both inputs': YAML that still
 * parses to a mapping, every property once (a duplicate key fails the parse).
 */
function frontmatterIsSound(merged: string, ours: string, theirs: string): boolean {
  const broken = (source: string): boolean =>
    parseFrontmatter(splitFrontmatter(source).raw).warning !== undefined
  return !broken(merged) || broken(ours) || broken(theirs)
}
