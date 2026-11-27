import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { inferSuggestionFields, suggestionMemberPaths, type TypeSuggestion } from '@kore/core'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useNoteBulkActions } from '@/lib/notes/use-note-bulk-actions'
import { saveTagType } from '@/lib/tags/tag-type-write'
import { useGraph } from '@/providers/graph-provider'

/**
 * Turn a suggestion into a type, on the user's explicit tap: write the
 * type's definition note (`tags/<tag>.md`, its fields guessed from what the
 * notes already hold, its home the notes' folder) and, for a folder of
 * untagged notes, add the tag to each of them through the bulk-tag path —
 * which skips notes with unsaved edits and names failures in the toast.
 * Resolves the number of notes newly tagged (0 for a tag that already
 * existed); throws when the definition cannot be written.
 */
export function useApplyTypeSuggestion(): (suggestion: TypeSuggestion) => Promise<number> {
  const { graph } = useGraph()
  const queryClient = useQueryClient()
  const bulk = useNoteBulkActions()

  return useCallback(
    async (suggestion: TypeSuggestion): Promise<number> => {
      if (graph === null) {
        throw new Error('No vault is open.')
      }
      const fields = await inferSuggestionFields(suggestion)
      await saveTagType(
        suggestion.tag,
        fields,
        graph.generation,
        suggestion.folder === null ? {} : { folder: suggestion.folder },
      )
      let tagged = 0
      if (suggestion.source === 'folder') {
        const outcome = await bulk.tag(await suggestionMemberPaths(suggestion), suggestion.tag)
        tagged = outcome.changed
      }
      await queryClient.invalidateQueries({ queryKey: [INDEX_QUERY_SCOPE, graph.root] })
      return tagged
    },
    [bulk, graph, queryClient],
  )
}
