import { useCallback } from 'react'
import {
  PRIVATE_NOTE_EDIT_ERROR,
  TAG_DEFINITION_UNMARKED_ERROR,
  parseFrontmatter,
  splitFrontmatter,
} from '@reflect/core'
import { readNoteSource } from '@/lib/note-frontmatter'
import { readTagDefinition, saveTagType } from '@/lib/tags/tag-type-write'
import { invalidateOnNextIndexApply } from '@/lib/tags/use-commit-note-property'
import { useGraph } from '@/providers/graph-provider'

/** Shown when the tag's icon moved on between the proposal and the accept. */
export const STALE_TAG_ICON_MESSAGE =
  'The tag’s icon changed since this was proposed, so nothing was written. Ask for a fresh proposal.'

/** One accepted `set_tag_icon` proposal: the tag, the icon to store, and the icon it replaces. */
export interface TagIconChange {
  tag: string
  icon: string | null
  previousIcon: string | null
}

/**
 * Land a chat-proposed tag icon the user accepted (the review card's
 * Accept). Writes through the same definition-note writer the Configure-tag
 * dialog uses (`saveTagType`: the icon rides the typed frontmatter patch, so
 * an open definition note updates in place), after re-checking the
 * definition as it is *now*: a private definition refuses like the tool
 * would have, a regular note at the definition path is never stamped with
 * the tag marker from chat, and an icon that no longer matches the one the
 * card shows refuses as stale rather than overwriting a choice the user
 * made in between. Rejects with the failure; the caller shows it.
 */
export function useApplyTagIcon(): (change: TagIconChange) => Promise<void> {
  const { graph } = useGraph()
  const generation = graph?.generation ?? null
  return useCallback(
    async ({ tag, icon, previousIcon }: TagIconChange): Promise<void> => {
      if (generation === null) {
        throw new Error('No graph is open.')
      }
      const definition = await readTagDefinition(tag)
      if (definition.exists) {
        // Same channel `readTagDefinition` read from (live session first), so
        // a `private: true` typed and not yet saved still blocks the write.
        const { raw } = splitFrontmatter(await readNoteSource(definition.path))
        if (parseFrontmatter(raw).data.private) {
          throw new Error(PRIVATE_NOTE_EDIT_ERROR)
        }
        if (definition.needsConversion) {
          throw new Error(TAG_DEFINITION_UNMARKED_ERROR)
        }
      }
      if (definition.icon !== previousIcon) {
        throw new Error(STALE_TAG_ICON_MESSAGE)
      }
      await saveTagType(tag, definition.properties, generation, definition.template, icon)
      invalidateOnNextIndexApply()
    },
    [generation],
  )
}
