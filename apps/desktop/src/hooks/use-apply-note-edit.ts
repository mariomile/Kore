import { useCallback } from 'react'
import { applyNoteEdit, isAppError, readNote, type NoteEdit } from '@reflect/core'
import { openSession } from '@/editor/open-documents'
import { commitNoteBodyTransform } from '@/lib/note-frontmatter'
import { invalidateOnNextIndexApply } from '@/lib/tags/use-commit-note-property'
import { useGraph } from '@/providers/graph-provider'

/** Shown when the note moved on between the proposal and the accept. */
export const STALE_NOTE_EDIT_MESSAGE =
  'The note changed since this edit was proposed, so nothing was written. Ask for a fresh edit.'

/**
 * Land a chat-proposed note edit the user accepted (the review card's
 * Accept). Routes through the session-or-disk body channel — an open note
 * updates in place with its unsaved edits intact, a closed one is patched on
 * disk — and re-validates the hunk against the note as it is *now*: a
 * passage that no longer matches refuses with {@link STALE_NOTE_EDIT_MESSAGE}
 * rather than landing somewhere else, and a note deleted since the proposal
 * refuses rather than being recreated (an append has no passage to anchor
 * on, so the note's existence is its one guard). Rejects with the failure;
 * the caller shows it.
 */
export function useApplyNoteEdit(): (path: string, edit: NoteEdit) => Promise<void> {
  const { graph } = useGraph()
  const generation = graph?.generation ?? null
  return useCallback(
    async (path: string, edit: NoteEdit): Promise<void> => {
      if (generation === null) {
        throw new Error('No graph is open.')
      }
      // A loaded session is the note; otherwise disk has to still have it.
      if ((openSession(path)?.liveContent() ?? null) === null) {
        await assertNoteExists(path)
      }
      await commitNoteBodyTransform(
        path,
        (source) => {
          const result = applyNoteEdit(source, edit)
          if (!result.ok) {
            throw new Error(STALE_NOTE_EDIT_MESSAGE)
          }
          return result.after
        },
        generation,
      )
      invalidateOnNextIndexApply()
    },
    [generation],
  )
}

/** Refuse (as stale) a note that no longer exists on disk. */
async function assertNoteExists(path: string): Promise<void> {
  try {
    await readNote(path)
  } catch (cause) {
    if (isAppError(cause) && cause.kind === 'notFound') {
      throw new Error(STALE_NOTE_EDIT_MESSAGE)
    }
    throw cause
  }
}
