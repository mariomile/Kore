import { useCallback } from 'react'
import { errorMessage, type TagType } from '@reflect/core'
import { toast } from '@/components/ui/toast'
import { useTemplateValues } from '@/hooks/use-template-values'
import { useGraph } from '@/providers/graph-provider'
import { createTypedCollectionNote } from './create-collection-note'

/**
 * Create a note born in a collection — tagged, seeded with the given
 * property values, body from the tag's bound template — surfacing failures
 * as a toast. The one create path the board's lane + and the calendar's
 * day + share; returns the new path, or `null` when nothing was created.
 */
export function useCreateCollectionNote(
  tag: string,
  type: TagType,
): (properties: Record<string, unknown>) => Promise<string | null> {
  const { graph } = useGraph()
  const resolveTemplateValues = useTemplateValues()
  return useCallback(
    async (properties: Record<string, unknown>): Promise<string | null> => {
      if (graph === null) {
        return null
      }
      try {
        return await createTypedCollectionNote(
          tag,
          graph.generation,
          properties,
          type,
          await resolveTemplateValues(null),
        )
      } catch (error) {
        toast.add({
          type: 'error',
          title: "Couldn't create the note",
          description: errorMessage(error),
        })
        return null
      }
    },
    [graph, resolveTemplateValues, tag, type],
  )
}
