import { useCallback } from 'react'
import type { SlashMenuItem, SlashMenuSearchHandler } from '@meowdown/react'
import { foldTag, formatCollectionEmbed, hasBridge, listNoteTags } from '@reflect/core'
import { useGraph } from '@/providers/graph-provider'
import type { NoteEditorHandle } from './note-editor'

/**
 * The editor's `/` menu rows for embedding a Collection in the current note.
 * Every tag becomes a row (every tag is a collection); selecting one inserts a ` ```collection `
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
      return tags.map((facet) => {
        const tagKey = foldTag(facet.tag)
        return {
          id: `collection:${tagKey}`,
          label: `Collection: #${tagKey}`,
          keywords: ['collection', 'embed', 'database', tagKey],
          onSelect: () => {
            const editor = getEditor()
            editor?.insertMarkdown(
              `${formatCollectionEmbed({ tag: tagKey, view: 'table', sort: null, group: null, filters: [] })}\n`,
            )
          },
        }
      })
    },
    [graph, getEditor],
  )
}
