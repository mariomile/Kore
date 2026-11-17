import { useQuery } from '@tanstack/react-query'
import { noteSkeleton, readNote, type NoteSkeletonRow } from '@kore/core'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'

const EMPTY: readonly NoteSkeletonRow[] = []

/**
 * A note's miniature (`noteSkeleton` over its file), for thumbnails of notes
 * that are not open. Lives under the index scope so a re-index of the file
 * redraws it; a read failure (moved, deleted) degrades to a blank sheet.
 */
export function useNoteSkeleton(path: string): readonly NoteSkeletonRow[] {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const { data } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'note-skeleton', path],
    queryFn: async () => {
      try {
        return noteSkeleton(await readNote(path))
      } catch {
        return EMPTY
      }
    },
    enabled: bridgeReady && graph !== null,
    staleTime: 60_000,
  })
  return data ?? EMPTY
}
