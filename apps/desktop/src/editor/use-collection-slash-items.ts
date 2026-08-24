import { useCallback } from 'react'
import type { SlashMenuItem, SlashMenuSearchHandler } from '@meowdown/react'
import { formatCollectionEmbed, hasBridge, listTagTypes } from '@reflect/core'
import { useGraph } from '@/providers/graph-provider'
import type { NoteEditorHandle } from './note-editor'

/**
 * The editor's `/` menu rows for embedding a Collection in the current note.
 * Each typed tag becomes a row; selecting one inserts a ` ```collection `
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
      const types = await listTagTypes()
      return types.map((entry) => ({
        id: `collection:${entry.tagKey}`,
        label: `Collection: #${entry.tagKey}`,
        keywords: ['collection', 'embed', 'database', entry.tagKey],
        onSelect: () => {
          const editor = getEditor()
          editor?.insertMarkdown(`${formatCollectionEmbed({ tag: entry.tagKey, view: 'table' })}\n`)
        },
      }))
    },
    [graph, getEditor],
  )
}
