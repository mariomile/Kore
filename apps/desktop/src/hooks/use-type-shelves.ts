import { useMemo } from 'react'
import { splitTypesFromTags, type TagTreeNode } from '@kore/core'
import { useTagTypes } from '@/hooks/use-tag-icons'
import { useTagTree } from '@/hooks/use-tag-tree'

export interface TypeShelves {
  /** Configured tags pinned at top, carrying any unconfigured sub-tags beneath them. */
  types: readonly TagTreeNode[]
  /** Every remaining unconfigured tag, nested on `/`. */
  tags: readonly TagTreeNode[]
}

/**
 * Splits the active graph's tag tree into configured tags and remaining tags
 * via {@link splitTypesFromTags}. React Query shares the underlying fetches.
 */
export function useTypeShelves(): TypeShelves {
  const tree = useTagTree()
  const typed = useTagTypes()
  return useMemo(
    () =>
      splitTypesFromTags(
        tree,
        typed.map((entry) => entry.tagKey),
      ),
    [tree, typed],
  )
}
