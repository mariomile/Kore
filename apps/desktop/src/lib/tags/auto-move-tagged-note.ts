import { homePathForTaggedInboxNote } from '@kore/core'
import { moveNoteCarryingSession } from '@/editor/move-note'
import { rewriteMovedNotePathLinks } from '@/lib/notes/rewrite-moved-path-links'

/**
 * When a titled note sitting in the vault's new-note / inbox folder receives a
 * `#tag` whose schema declares a default `folder:`, move the note into that
 * folder (carrying any open editor session and rewriting inbound path links).
 *
 * Best-effort after the tag write: a move failure logs a warning and leaves
 * the newly added tag intact. Notes already filed outside the inbox folder are
 * never moved, so multi-tag notes never fight over disk location.
 */
export async function maybeMoveTaggedInboxNote(
  path: string,
  homeFolder: string | undefined,
  generation: number,
): Promise<string | null> {
  if (homeFolder === undefined) {
    return null
  }
  try {
    const target = await homePathForTaggedInboxNote(path, homeFolder)
    if (target === null || target === path) {
      return null
    }
    await moveNoteCarryingSession(path, target, generation)
    await rewriteMovedNotePathLinks([{ from: path, to: target }], generation)
    return target
  } catch (cause) {
    console.warn(`tag auto-move skipped for ${path}:`, cause)
    return null
  }
}
