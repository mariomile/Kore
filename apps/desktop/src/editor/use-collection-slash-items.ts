import { useCallback } from 'react'
import type { SlashMenuItem, SlashMenuSearchHandler } from '@meowdown/react'
import {
  type CollectionEmbed,
  foldTag,
  formatCollectionEmbed,
  hasBridge,
  listNoteTags,
} from '@reflect/core'
import { useGraph } from '@/providers/graph-provider'
import type { NoteEditorHandle } from './note-editor'

/** Insert a collection block and leave the caret in the following paragraph. */
export function insertCollectionEmbed(editor: NoteEditorHandle, embed: CollectionEmbed): void {
  editor.insertMarkdown(`${formatCollectionEmbed(embed)}\n`, { selection: 'after-block' })
}

/**
 * The editor's `/` menu rows for embedding a live supertag view.
 * Selecting a tag inserts a portable ` ```collection `
 * fence. meowdown filters against the typed query and strips `/query` before
 * `onSelect`, so the fence lands at a clean cursor.
 *
 * `getEditor` is read at select time: a late resolve after the pane unmounted
 * must insert nowhere rather than somewhere stale.
 */
export function useCollectionSlashItems(
  getEditor: () => NoteEditorHandle | null,
): SlashMenuSearchHandler {
  const { graph } = useGraph()

  return useCallback(
    async (_query: string): Promise<SlashMenuItem[]> => {
      if (!hasBridge() || graph === null) {
        return []
      }
      const tags = await listNoteTags()
      const tagItems = tags.map((facet): SlashMenuItem => {
        const tagKey = foldTag(facet.tag)
        return {
          id: `collection:${tagKey}`,
          label: `Type: #${tagKey}`,
          keywords: ['type', 'supertag', 'tag', 'embed', 'list', tagKey],
          detail: 'Live view of this type’s notes',
          onSelect: () => {
            const editor = getEditor()
            if (editor !== null) {
              insertCollectionEmbed(editor, {
                selection: { kind: 'tag', tag: tagKey },
                view: 'table',
                sorts: [],
                group: null,
                filters: [],
                match: 'all',
              })
            }
          },
        }
      })
      return tagItems
    },
    [graph, getEditor],
  )
}
