import { useQuery } from '@tanstack/react-query'
import { getFolderTree, type FolderTreeFolder } from '@reflect/core'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'

/**
 * The vault's folder tree from the index, kept fresh by the usual index
 * invalidation (a file lands or moves, the watcher re-indexes it, the query
 * refetches). Null until the first fetch resolves.
 */
export function useFolderTree(): FolderTreeFolder | null {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const { data } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'folder-tree'],
    queryFn: () => getFolderTree(),
    enabled: bridgeReady && graph !== null,
  })
  return data ?? null
}
