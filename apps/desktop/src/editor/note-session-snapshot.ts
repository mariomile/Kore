import type { NoteSessionSnapshot } from './note-session-types'

/**
 * Field-wise equality against the last emitted snapshot, so a session only
 * notifies subscribers when something surfaced actually changed. `previous`
 * is `null` before the first emit (never equal).
 */
export function sameSnapshot(
  previous: NoteSessionSnapshot | null,
  next: NoteSessionSnapshot,
): boolean {
  return (
    previous !== null &&
    previous.status === next.status &&
    previous.initialContent === next.initialContent &&
    previous.header === next.header &&
    previous.protected === next.protected &&
    previous.dirty === next.dirty &&
    previous.missing === next.missing &&
    previous.conflict === next.conflict &&
    previous.error === next.error
  )
}
