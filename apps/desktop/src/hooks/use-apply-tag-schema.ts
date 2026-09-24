import { useCallback } from 'react'
import {
  PRIVATE_NOTE_EDIT_ERROR,
  TAG_DEFINITION_UNMARKED_ERROR,
  parseFrontmatter,
  splitFrontmatter,
  type TagProperty,
} from '@reflect/core'
import { readNoteSource } from '@/lib/note-frontmatter'
import { migratePropertyRenames, planPropertyRenames } from '@/lib/tags/schema-renames'
import { readTagDefinition, saveTagType } from '@/lib/tags/tag-type-write'
import { invalidateOnNextIndexApply } from '@/lib/tags/use-commit-note-property'
import { useGraph } from '@/providers/graph-provider'

/** Shown when the tag's schema moved on between the proposal and the accept. */
export const STALE_TAG_SCHEMA_MESSAGE =
  'The type’s properties changed since this was proposed, so nothing was written. Ask for a fresh proposal.'

/** One accepted `set_tag_schema` proposal: the schema to write, the one it replaces, the renames. */
export interface TagSchemaChange {
  tag: string
  properties: TagProperty[]
  previousProperties: TagProperty[]
  renames: { from: string; to: string }[]
}

/**
 * Land a chat-proposed tag schema the user accepted (the review card's
 * Accept). Writes through the same definition-note writer the Configure-tag
 * dialog uses (`saveTagType`), after re-checking the definition as it is
 * *now* — a private definition refuses like the tool would have, a regular
 * note at the definition path is never stamped with the tag marker from
 * chat, and a schema that no longer matches the one the card shows refuses
 * as stale rather than overwriting an edit the user made in between.
 *
 * A key rename then moves the notes' stored values through the dialog's own
 * two-step migration (`planPropertyRenames` / `migratePropertyRenames`), so
 * the values land under the new key instead of being orphaned. The schema is
 * written first: a migration that fails partway leaves the definition
 * correct and the remaining values under their old key, which the user can
 * see and redo — the reverse would leave values under a key no schema names.
 */
export function useApplyTagSchema(): (change: TagSchemaChange) => Promise<void> {
  const { graph } = useGraph()
  const generation = graph?.generation ?? null
  return useCallback(
    async ({ tag, properties, previousProperties, renames }: TagSchemaChange): Promise<void> => {
      if (generation === null) {
        throw new Error('No graph is open.')
      }
      const definition = await readTagDefinition(tag)
      // Same channel `readTagDefinition` read from (live session first), so a
      // `private: true` typed and not yet saved still blocks the write. A
      // missing definition reads as empty on that channel — that is the
      // brand-new tag `saveTagType` creates, not a regular note to refuse.
      const source = await readNoteSource(definition.path)
      if (source.trim() !== '') {
        if (parseFrontmatter(splitFrontmatter(source).raw).data.private) {
          throw new Error(PRIVATE_NOTE_EDIT_ERROR)
        }
        if (definition.needsConversion) {
          throw new Error(TAG_DEFINITION_UNMARKED_ERROR)
        }
      }
      if (JSON.stringify(definition.properties) !== JSON.stringify(previousProperties)) {
        throw new Error(STALE_TAG_SCHEMA_MESSAGE)
      }
      // Planned against the index as it is now, not against what the model
      // saw: a note that gained the old key since the proposal migrates too,
      // and one that lost it drops out instead of writing an empty value.
      const planned = await planPropertyRenames(renames)
      await saveTagType(tag, properties, generation, definition.template, definition.icon)
      await migratePropertyRenames(planned, generation)
      invalidateOnNextIndexApply()
    },
    [generation],
  )
}
