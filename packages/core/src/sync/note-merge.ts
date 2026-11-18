import { lineHunks, type LineHunk } from '@kore/utils'
import { detectConflictMarkers } from '../markdown/conflict-markers'
import { parseFrontmatter, splitFrontmatter } from '../markdown/frontmatter'

/** Which side's edit is newer, for the one place that can't keep both. */
export type NewerSide = 'ours' | 'theirs'

/**
 * A three-way merge for a note two devices edited between syncs that never
 * drops anyone's writing and never asks the user to pick:
 *
 * - **Edits that don't touch** (including neighbouring lines, and both
 *   devices appending at one spot) all land, this device's lines first.
 * - **The same edit on both devices** lands once.
 * - **The same lines changed two different ways** (or edited on one device
 *   and deleted on the other) keep *both* versions, one after the other, as
 *   ordinary lines the user can tidy like any other text.
 * - **Properties** (the frontmatter header) can't hold two values for one
 *   key, so there a clash takes the `newer` side's value; the older one stays
 *   in the note's history.
 *
 * Returns `null` only when a version already carries unresolved conflict
 * markers, which are left for the user rather than buried.
 */
export function mergeNoteText(
  base: string,
  ours: string,
  theirs: string,
  newer: NewerSide,
): string | null {
  if (ours === theirs) {
    return ours
  }
  if (detectConflictMarkers(ours) || detectConflictMarkers(theirs)) {
    return null
  }
  const [baseHeader, baseBody] = splitHeader(base)
  const [ourHeader, ourBody] = splitHeader(ours)
  const [theirHeader, theirBody] = splitHeader(theirs)
  const newerHeader = newer === 'ours' ? ourHeader : theirHeader
  const keepBoth: OnClash = (mine, other) => [...mine, ...other]
  const takeNewer: OnClash = (mine, other) => (newer === 'ours' ? mine : other)
  const header = mergeLines(baseHeader, ourHeader, theirHeader, takeNewer)
  const body = mergeLines(baseBody, ourBody, theirBody, keepBoth)
  // A header merge that breaks the YAML (the same property added on both
  // devices) falls back to the newer side's header whole.
  const safeHeader = headerIsBroken(header) && !headerIsBroken(newerHeader) ? newerHeader : header
  return safeHeader + body
}

/** A note's frontmatter block (fences included, empty when none) and its body. */
function splitHeader(source: string): [string, string] {
  const { bodyOffset } = splitFrontmatter(source)
  return [source.slice(0, bodyOffset), source.slice(bodyOffset)]
}

function headerIsBroken(header: string): boolean {
  return parseFrontmatter(splitFrontmatter(header).raw).warning !== undefined
}

/** How to settle the same lines changed two different ways. */
type OnClash = (ours: readonly string[], theirs: readonly string[]) => readonly string[]

function mergeLines(base: string, ours: string, theirs: string, onClash: OnClash): string {
  const baseLines = base.split('\n')
  const out: string[] = []
  let cursor = 0
  for (const group of changeGroups(baseLines, ours.split('\n'), theirs.split('\n'))) {
    out.push(...baseLines.slice(cursor, group.lo), ...resolveGroup(baseLines, group, onClash))
    cursor = group.hi
  }
  out.push(...baseLines.slice(cursor))
  return out.join('\n')
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

function resolveGroup(
  base: readonly string[],
  group: ChangeGroup,
  onClash: OnClash,
): readonly string[] {
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
    return [...ourText, ...theirText] // both added here: keep both
  }
  return onClash(ourText, theirText)
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
