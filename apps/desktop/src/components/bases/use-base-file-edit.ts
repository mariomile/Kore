import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { errorMessage, parseBaseFile, updateBaseFile } from '@kore/core'
import { toast } from '@/components/ui/toast'
import { useGraph } from '@/providers/graph-provider'
import { baseDefinitionQueryKey } from './use-base-view'

/**
 * Write one change to a `.base` file (a `base-file-edit.ts` edit of its
 * text) and show it at once: the parsed result replaces the cached
 * definition, so the page moves before the watcher reports the write.
 * Resolves false when the write failed (a toast says why).
 */
export function useBaseFileEdit(
  path: string,
): (change: (text: string) => string) => Promise<boolean> {
  const { graph } = useGraph()
  const queryClient = useQueryClient()
  return useCallback(
    async (change) => {
      if (graph === null) {
        return false
      }
      try {
        const text = await updateBaseFile(path, graph.generation, change)
        queryClient.setQueryData(baseDefinitionQueryKey(graph.root, path), parseBaseFile(text))
        return true
      } catch (error) {
        toast.add({
          type: 'error',
          title: 'Couldn’t change this base',
          description: errorMessage(error),
        })
        return false
      }
    },
    [graph, path, queryClient],
  )
}
