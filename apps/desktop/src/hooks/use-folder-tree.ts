import { useQuery } from '@tanstack/react-query'
import { getFolderTree, type FolderTreeFolder } from '@kore/core'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { FOLDER_TREE_QUERY, INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'

/**
 * The vault's folder tree from the index, kept fresh by index invalidation (a
 * file lands, moves or is retitled, the watcher re-indexes it, the query
 * refetches; a body-only save skips it, see `invalidateIndexQueriesFor`).
 * Null until the first fetch resolves.
 */
export function useFolderTree(): FolderTreeFolder | null {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const { data } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, FOLDER_TREE_QUERY],
    queryFn: () => getFolderTree(),
    enabled: bridgeReady && graph !== null,
  })
  return data ?? null
}
