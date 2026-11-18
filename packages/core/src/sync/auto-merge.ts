import { readNote, writeNote } from '../graph/commands'
import { isNotePath } from '../graph/paths'
import { detectConflictMarkers } from '../markdown/conflict-markers'
import { gitNoteVersion, type ChangedFile, type MergeOutcome, type MergeSides } from './commands'
import { mergeNoteText } from './note-merge'

/**
 * After a conflicted sync merge, re-merge each conflicted note with
 * {@link mergeNoteText}, which keeps every device's writing, and replace the
 * conflict markers with the merged note: nothing to review, nothing lost.
 *
 * A note is only rewritten while it still carries the markers this merge
 * wrote: one the user already resolved, or edited meanwhile, is left alone.
 * Every step is per note and best-effort; a failure leaves that note's
 * markers in place, which is the state sync already handles.
 *
 * Returns the notes it rewrote, as file changes for the caller to fan out.
 */
export async function autoMergeConflicts(
  outcome: MergeOutcome,
  generation: number,
): Promise<ChangedFile[]> {
  const sides = outcome.sides
  if (sides === null || sides === undefined) {
    return []
  }
  const notes = outcome.conflictedPaths.filter(isNotePath)
  const rewritten = await Promise.all(notes.map((path) => remergeNote(path, sides, generation)))
  return rewritten.filter((change): change is ChangedFile => change !== null)
}

/** Re-merge one conflicted note; the file change when it was rewritten. */
async function remergeNote(
  path: string,
  sides: MergeSides,
  generation: number,
): Promise<ChangedFile | null> {
  try {
    const [ours, theirs, base, current] = await Promise.all([
      gitNoteVersion(sides.ours, path, generation),
      gitNoteVersion(sides.theirs, path, generation),
      sides.base === null ? '' : versionOrEmpty(sides.base, path, generation),
      readNote(path, generation),
    ])
    const merged = detectConflictMarkers(current)
      ? mergeNoteText(base, ours, theirs, sides.theirsTime > sides.oursTime ? 'theirs' : 'ours')
      : null
    if (merged === null) {
      return null // still conflicted, or already resolved since the merge
    }
    await writeNote(path, merged, generation)
    return { path, kind: 'upsert' }
  } catch {
    return null // leave this note's markers for the user
  }
}

/** The note at `commit`, or empty when it didn't exist there (added on both sides). */
async function versionOrEmpty(commit: string, path: string, generation: number): Promise<string> {
  try {
    return await gitNoteVersion(commit, path, generation)
  } catch {
    return ''
  }
}
