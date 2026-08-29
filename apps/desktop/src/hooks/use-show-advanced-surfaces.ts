import { useQuery } from '@tanstack/react-query'
import { vaultScanStats } from '@reflect/core'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { ADVANCED_SURFACE_NOTE_THRESHOLD, showAdvancedSurfaces } from '@/lib/progressive-disclosure'
import { useGraph } from '@/providers/graph-provider'

/**
 * Whether agents, embeddings, and tag schema should be visible.
 * While the count is unknown we show the surfaces so Settings tests and a
 * mid-load settings page do not flicker empty.
 *
 * Deliberately outside `INDEX_QUERY_SCOPE`. This asks one question, "is this
 * vault past the disclosure threshold", and the answer does not move while
 * you type. Under that scope it refetched on every index invalidation round,
 * which is every write and every watcher batch, throttled to one round every
 * three seconds. Each refetch walks the whole vault with a `metadata()` call
 * per entry, and it is mounted in the always-visible sidebar: measured at
 * 5.2 ms for 2,500 files, 28.9 ms at 12,000 and 73.8 ms at 30,000.
 */
export function useShowAdvancedSurfaces(): boolean {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const { data } = useQuery({
    queryKey: ['vault-scan-stats', graph?.root],
    queryFn: () => vaultScanStats(graph!.generation),
    enabled: bridgeReady && graph !== null,
  })
  return showAdvancedSurfaces(data?.notes ?? ADVANCED_SURFACE_NOTE_THRESHOLD)
}
