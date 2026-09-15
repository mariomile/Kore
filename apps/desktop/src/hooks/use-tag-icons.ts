import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listTagTypes } from '@reflect/core'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'

/** Query key for every typed tag's schema, under the index scope. */
export function tagTypesQueryKey(
  root: string | undefined,
): readonly [string, string | undefined, string] {
  return [INDEX_QUERY_SCOPE, root, 'tag-types']
}

/**
 * Folded tag key to its emoji icon, for surfaces that name many tags at once
 * (the sidebar's Tags section). Tags without a definition or an icon are
 * simply absent.
 */
export function useTagIcons(): ReadonlyMap<string, string> {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const { data } = useQuery({
    queryKey: tagTypesQueryKey(graph?.root),
    queryFn: () => listTagTypes(),
    enabled: bridgeReady && graph !== null,
  })
  return useMemo(() => {
    const icons = new Map<string, string>()
    for (const entry of data ?? []) {
      if (entry.type.icon !== undefined) {
        icons.set(entry.tagKey, entry.type.icon)
      }
    }
    return icons
  }, [data])
}
