import { useQuery } from '@tanstack/react-query'
import { listNoteTags, type NoteTagFacet } from '@reflect/core'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { allNotesTagsQueryKey } from '@/lib/notes/all-notes-query'
import { useGraph } from '@/providers/graph-provider'

/**
 * Every tag carried by a non-daily note, with counts, alphabetical — the same
 * facet query (and cache entry) the All Notes Custom filter menu rides, so
 * the sidebar's Tags section and that menu can never disagree.
 */
export function useNoteTags(): NoteTagFacet[] {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const { data } = useQuery({
    queryKey: allNotesTagsQueryKey(graph?.root),
    queryFn: () => listNoteTags(),
    enabled: bridgeReady && graph !== null,
  })
  return data ?? []
}
