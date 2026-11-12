import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listTagTypes, splitTypesFromTags, type TagTreeNode, type TypeShelfEntry } from '@kore/core'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { tagTypesQueryKey } from '@/hooks/use-tag-icons'
import { useTagTree } from '@/hooks/use-tag-tree'
import { useGraph } from '@/providers/graph-provider'

export interface TypeShelves {
  /** Tags with a definition: what a note *is*. */
  types: readonly TypeShelfEntry[]
  /** Every other tag, still nested on `/`: what a note is *about*. */
  tags: readonly TagTreeNode[]
}

/**
 * The sidebar's Types and Tags shelves from one tag tree and the typed-tag
 * list (the same queries the Tags shelf and its icons already run), split by
 * `splitTypesFromTags`. Both shelves call it; React Query shares the fetches.
 */
export function useTypeShelves(): TypeShelves {
  const tree = useTagTree()
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const { data: typed } = useQuery({
    queryKey: tagTypesQueryKey(graph?.root),
    queryFn: () => listTagTypes(),
    enabled: bridgeReady && graph !== null,
  })
  return useMemo(
    () =>
      splitTypesFromTags(
        tree,
        (typed ?? []).map((entry) => entry.tagKey),
      ),
    [tree, typed],
  )
}
