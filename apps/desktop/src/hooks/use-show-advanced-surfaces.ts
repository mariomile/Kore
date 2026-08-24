import { useQuery } from '@tanstack/react-query'
import { vaultScanStats } from '@reflect/core'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { useGraphRole } from '@/hooks/use-graph-role'
import { ADVANCED_SURFACE_NOTE_THRESHOLD, showAdvancedSurfaces } from '@/lib/progressive-disclosure'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'

/**
 * Whether agents, embeddings, and tag schema should be visible. Company
 * graphs always show them; personal graphs wait until there are enough notes.
 * While the count is unknown we show the surfaces so Settings tests and a
 * mid-load settings page do not flicker empty.
 */
export function useShowAdvancedSurfaces(): boolean {
  const { graph } = useGraph()
  const { role } = useGraphRole()
  const bridgeReady = useBridgeReady()
  const { data } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'vault-scan-stats'],
    queryFn: () => vaultScanStats(graph!.generation),
    enabled: bridgeReady && graph !== null,
  })
  return showAdvancedSurfaces(data?.notes ?? ADVANCED_SURFACE_NOTE_THRESHOLD, role)
}
