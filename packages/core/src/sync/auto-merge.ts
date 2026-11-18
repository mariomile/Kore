import { readNote, writeNote } from '../graph/commands'
import { isNotePath } from '../graph/paths'
import { detectConflictMarkers } from '../markdown/conflict-markers'
import { gitNoteVersion, type ChangedFile, type MergeOutcome } from './commands'
import { mergeNoteText } from './note-merge'

/**
 * After a conflicted sync merge, re-merge each conflicted note with the
 * Markdown-aware rules of {@link mergeNoteText} and, where both devices'
 * edits can be kept, replace the conflict markers with the merged note.
 * Notes that still conflict keep their markers (and `Needs review`).
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
  if (outcome.kind !== 'mergedWithConflicts' || sides === null || sides === undefined) {
    return []
  }
  const rewritten: ChangedFile[] = []
  for (const path of outcome.conflictedPaths) {
    if (!isNotePath(path)) {
      continue
    }
    try {
      const [ours, theirs, base, current] = await Promise.all([
        gitNoteVersion(sides.ours, path, generation),
        gitNoteVersion(sides.theirs, path, generation),
        sides.base === null ? Promise.resolve('') : versionOrEmpty(sides.base, path, generation),
        readNote(path, generation),
      ])
      if (!detectConflictMarkers(current)) {
        continue // already resolved (or rewritten) since the merge
      }
      const merged = mergeNoteText(base, ours, theirs)
      if (merged === null) {
        continue
      }
      await writeNote(path, merged, generation)
      rewritten.push({ path, kind: 'upsert' })
    } catch {
      // Leave this note's markers for the user; the next note may still merge.
    }
  }
  return rewritten
}

/** The note at `commit`, or empty when it didn't exist there (added on both sides). */
async function versionOrEmpty(commit: string, path: string, generation: number): Promise<string> {
  try {
    return await gitNoteVersion(commit, path, generation)
  } catch {
    return ''
  }
}
