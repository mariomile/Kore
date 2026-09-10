import { useCallback } from 'react'
import type { SlashMenuItem, SlashMenuSearchHandler } from '@meowdown/react'
import {
  type CollectionEmbed,
  foldTag,
  formatCollectionEmbed,
  hasBridge,
  listCollectionDefinitions,
  listNoteTags,
} from '@reflect/core'
import { useGraph } from '@/providers/graph-provider'
import { stableCollectionReferenceForPath } from '@/lib/tags/reusable-collection-write'
import type { NoteEditorHandle } from './note-editor'

/** Insert a collection block and leave the caret in the following paragraph. */
export function insertCollectionEmbed(editor: NoteEditorHandle, embed: CollectionEmbed): void {
  editor.insertMarkdown(`${formatCollectionEmbed(embed)}\n`, { selection: 'after-block' })
}

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
  onCreateCollection?: () => void,
): SlashMenuSearchHandler {
  const { graph } = useGraph()

  return useCallback(
    async (_query: string): Promise<SlashMenuItem[]> => {
      if (!hasBridge() || graph === null) {
        return []
      }
      const [definitions, tags] = await Promise.all([listCollectionDefinitions(), listNoteTags()])
      const create: SlashMenuItem[] =
        onCreateCollection === undefined
          ? []
          : [
              {
                id: 'collection:create',
                label: 'Create collection…',
                keywords: ['collection', 'create', 'database'],
                onSelect: onCreateCollection,
              },
            ]
      const named = await Promise.all(
        definitions.map(async (definition): Promise<SlashMenuItem> => {
          const reference = await stableCollectionReferenceForPath(definition.path)
          return {
            id: `collection:definition:${definition.path}`,
            label: `Collection: ${definition.title}`,
            keywords: ['collection', 'embed', 'database', definition.title],
            onSelect: () => {
              const editor = getEditor()
              if (editor !== null) {
                insertCollectionEmbed(editor, {
                  selection: {
                    kind: 'definition',
                    reference,
                  },
                  view: 'table',
                  sorts: [],
                  group: null,
                  filters: [],
                  match: 'all',
                })
              }
            },
          }
        }),
      )
      const tagItems = tags.map((facet): SlashMenuItem => {
        const tagKey = foldTag(facet.tag)
        return {
          id: `collection:${tagKey}`,
          label: `Collection: #${tagKey}`,
          keywords: ['collection', 'embed', 'database', tagKey],
          detail: 'Live collection view',
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
      return [...create, ...named, ...tagItems]
    },
    [graph, getEditor, onCreateCollection],
  )
}
