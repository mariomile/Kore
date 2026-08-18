import { parseTaskMarker } from '../markdown/task-marker'

/**
 * Task priority, written in the task's own markdown as a leading bang run:
 * `[ ] !! Pay taxes` is high, `[ ] ! Buy milk` is medium, no marker is none.
 * The marker lives in the text — not frontmatter or the index schema — so it
 * survives every markdown round trip, shows in the editor, and syncs like any
 * other character. Three or more bangs read as prose, not a marker.
 */
export type TaskPriority = 'high' | 'medium'

/** Rank for sorting: high before medium before none. */
const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, medium: 1 }

const PRIORITY_MARKER_RE = /^(!{1,2})(?:\s+|$)/

/**
 * The priority of a task's *content* (its line after the checkbox marker),
 * or null. The bang run must open the content and stand alone — `!important`
 * is prose.
 */
export function taskContentPriority(content: string): TaskPriority | null {
  const match = PRIORITY_MARKER_RE.exec(content)
  if (match === null) {
    return null
  }
  return match[1] === '!!' ? 'high' : 'medium'
}

/** `content` without its priority marker (unchanged when there is none). */
export function stripTaskContentPriority(content: string): string {
  return content.replace(PRIORITY_MARKER_RE, '')
}

/** Rewrite `content`'s priority marker: null clears it. */
export function withTaskContentPriority(content: string, priority: TaskPriority | null): string {
  const rest = stripTaskContentPriority(content)
  if (priority === null) {
    return rest
  }
  return `${priority === 'high' ? '!!' : '!'} ${rest}`
}

/**
 * The next priority in the cycle none → medium (`!`) → high (`!!`) → none —
 * one keystroke walks a task through every state.
 */
export function cycleTaskContentPriority(content: string): string {
  const current = taskContentPriority(content)
  const next: TaskPriority | null =
    current === null ? 'medium' : current === 'medium' ? 'high' : null
  return withTaskContentPriority(content, next)
}

/**
 * The priority of a raw task line (`[ ] …`, the index's `raw` column) — the
 * checkbox marker is skipped the same way task content derivation does it.
 */
export function taskRawPriority(raw: string): TaskPriority | null {
  if (parseTaskMarker(raw.slice(0, 3)) === null) {
    return null
  }
  const rest = raw.slice(3)
  const content = rest[0] === ' ' || rest[0] === '\t' ? rest.slice(1) : rest
  return taskContentPriority(content)
}

/**
 * Compare two priorities for sorting: high first, none last. Equal ranks
 * return 0 so callers keep their own tiebreak.
 */
export function compareTaskPriority(left: TaskPriority | null, right: TaskPriority | null): number {
  const leftRank = left === null ? 2 : PRIORITY_RANK[left]
  const rightRank = right === null ? 2 : PRIORITY_RANK[right]
  return leftRank - rightRank
}
