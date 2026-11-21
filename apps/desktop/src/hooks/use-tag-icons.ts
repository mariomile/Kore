import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listTagTypes, type TagTypeEntry } from '@kore/core'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'

/** Query key for every configured tag's schema, under the index scope. */
export function tagTypesQueryKey(
  root: string | undefined,
): readonly [string, string | undefined, string] {
  return [INDEX_QUERY_SCOPE, root, 'tag-types']
}

/**
 * Every configured tag definition in the active graph (shared React Query cache
 * across the sidebar, tag pickers, and icon lookups).
 */
export function useTagTypes(enabled = true): readonly TagTypeEntry[] {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const { data } = useQuery({
    queryKey: tagTypesQueryKey(graph?.root),
    queryFn: () => listTagTypes(),
    enabled: enabled && bridgeReady && graph !== null,
  })
  return data ?? []
}

/**
 * Folded tag key to its emoji icon, for surfaces that name many tags at once
 * (the sidebar's Tags section). Tags without a definition or an icon are
 * simply absent.
 */
export function useTagIcons(): ReadonlyMap<string, string> {
  const tagTypes = useTagTypes()
  return useMemo(() => {
    const icons = new Map<string, string>()
    for (const entry of tagTypes) {
      if (entry.type.icon !== undefined) {
        icons.set(entry.tagKey, entry.type.icon)
      }
    }
    return icons
  }, [tagTypes])
}
