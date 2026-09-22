import { useCallback } from 'react'
import {
  appendBodyTag,
  bodyHasTag,
  getTagType,
  missingCreatedStamps,
  parseFrontmatter,
  PRIVATE_NOTE_EDIT_ERROR,
  removeBodyTag,
  splitFrontmatter,
  upsertFrontmatter,
} from '@reflect/core'
import { commitNoteBodyTransform, readNoteSource } from '@/lib/note-frontmatter'
import { invalidateOnNextIndexApply } from '@/lib/tags/use-commit-note-property'
import { useGraph } from '@/providers/graph-provider'

/** Shown when the note's membership moved on between the proposal and the accept. */
export const STALE_NOTE_TYPE_MESSAGE =
  'The note’s tags changed since this was proposed, so nothing was written. Ask for a fresh proposal.'

/** One accepted `set_note_type` proposal: the note, the tag, and which way it goes. */
export interface NoteTypeChange {
  path: string
  tag: string
  /** Take the tag off instead of putting it on. */
  remove: boolean
}

/**
 * Land a chat-proposed note type the user accepted (the review card's
 * Accept). The write is the Type field's own — `appendBodyTag` plus the
 * type's `created` stamps in one transform, or `removeBodyTag` — so a note
 * typed from chat is byte-identical to one typed from the picker; the
 * hashtag is still the supertag (TDR 0005).
 *
 * The note is re-checked as it is *now*, on the same channel the write goes
 * through (live session first): a `private: true` typed since the proposal
 * refuses like the tool would have, and membership that already moved the
 * proposed way refuses as stale rather than silently doing nothing. Rejects
 * with the failure; the caller shows it.
 */
export function useApplyNoteType(): (change: NoteTypeChange) => Promise<void> {
  const { graph } = useGraph()
  const generation = graph?.generation ?? null
  return useCallback(
    async ({ path, tag, remove }: NoteTypeChange): Promise<void> => {
      if (generation === null) {
        throw new Error('No graph is open.')
      }
      const source = await readNoteSource(path)
      const { raw, body } = splitFrontmatter(source)
      if (parseFrontmatter(raw).data.private) {
        throw new Error(PRIVATE_NOTE_EDIT_ERROR)
      }
      if (bodyHasTag(body, tag) !== remove) {
        throw new Error(STALE_NOTE_TYPE_MESSAGE)
      }
      // Read the schema before the write, like the picker does: it decides
      // which stamps exist, and an untyped tag simply has none. Nothing is
      // stamped on the way out — unsetting a type must not date anything.
      const type = remove ? null : await getTagType(tag)
      await commitNoteBodyTransform(
        path,
        (current) => {
          if (remove) {
            return removeBodyTag(current, tag) ?? current
          }
          const tagged = appendBodyTag(current, tag)
          if (tagged === null) {
            return current
          }
          return upsertFrontmatter(tagged, missingCreatedStamps(tagged, type))
        },
        generation,
      )
      invalidateOnNextIndexApply()
    },
    [generation],
  )
}
