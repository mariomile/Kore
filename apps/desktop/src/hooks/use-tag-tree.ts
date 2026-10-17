import { useQuery } from '@tanstack/react-query'
import { getTagTree, type TagTreeNode } from '@reflect/core'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'

/**
 * Every tag on a non-daily note as a tree nested on `/`, with counts that
 * include descendants. Index-scoped, so a re-index refetches it like the
 * flat facet list. Empty until the first fetch resolves.
 */
export function useTagTree(): readonly TagTreeNode[] {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const { data } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'tag-tree'],
    queryFn: () => getTagTree(),
    enabled: bridgeReady && graph !== null,
  })
  return data ?? EMPTY
}

const EMPTY: readonly TagTreeNode[] = []
