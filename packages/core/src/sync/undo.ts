import { z } from 'zod'
import { deleteNote, writeNote } from '../graph/commands'
import { isDaily } from '../graph/paths'
import { call } from '../ipc/invoke'
import type { ActivitySitting } from './activity'
import { gitCommitAll } from './commands'

/**
 * Undo a sitting (Plan 33, A1 step 6): take back every change one author
 * made in one run of work, keeping whatever happened since. All or
 * nothing: when any note's changed lines were edited again, nothing is
 * written and the notes are named.
 */

const undoPreviewSchema = z.object({
  files: z.array(z.object({ path: z.string(), content: z.string().nullable() })),
  conflicts: z.array(z.object({ path: z.string(), reason: z.enum(['changedSince', 'binary']) })),
})
export type UndoPreview = z.infer<typeof undoPreviewSchema>

/** What undoing `oldest..=newest` would leave in each file; writes nothing. */
export async function gitUndoPreview(
  newest: string,
  oldest: string,
  generation: number,
): Promise<UndoPreview> {
  return await call('git_undo_preview', { newest, oldest, generation }, undoPreviewSchema)
}

/** Why a note blocks an undo. */
export type UndoConflictReason = 'changedSince' | 'binary' | 'notANote'

export type UndoSittingResult =
  | { readonly kind: 'undone'; readonly notes: readonly string[] }
  | { readonly kind: 'nothing' }
  | {
      readonly kind: 'conflict'
      readonly conflicts: readonly { path: string; reason: UndoConflictReason }[]
    }

export interface UndoSittingOptions {
  /** Removes a note the sitting created (default: {@link deleteNote}). */
  readonly remove?: (path: string, generation: number) => Promise<void>
}

/**
 * Undo `sitting`. The current state is committed first, so the undo is
 * itself a change in the log that can be undone; the undo is then one
 * commit by the owner. Daily notes the sitting created are emptied, not
 * removed, since daily notes are never deleted.
 */
export async function undoSitting(
  sitting: ActivitySitting,
  generation: number,
  options: UndoSittingOptions = {},
): Promise<UndoSittingResult> {
  const newest = sitting.commits[0]
  const oldest = sitting.commits.at(-1)
  if (newest === undefined || oldest === undefined) {
    return { kind: 'nothing' }
  }
  await gitCommitAll('Snapshot before undo', generation)
  const preview = await gitUndoPreview(newest, oldest, generation)
  const conflicts: { path: string; reason: UndoConflictReason }[] = [...preview.conflicts]
  for (const file of preview.files) {
    if (!file.path.endsWith('.md')) {
      conflicts.push({ path: file.path, reason: 'notANote' })
    }
  }
  if (conflicts.length > 0) {
    return { kind: 'conflict', conflicts }
  }
  if (preview.files.length === 0) {
    return { kind: 'nothing' }
  }
  const remove = options.remove ?? deleteNote
  for (const file of preview.files) {
    if (file.content !== null) {
      await writeNote(file.path, file.content, generation)
    } else if (isDaily(file.path)) {
      await writeNote(file.path, '', generation)
    } else {
      await remove(file.path, generation)
    }
  }
  await gitCommitAll('Undo changes', generation)
  return { kind: 'undone', notes: preview.files.map((file) => file.path) }
}
