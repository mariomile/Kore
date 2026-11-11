import { useQuery } from '@tanstack/react-query'
import { loadCyberBrainConfig } from '@reflect/core'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'

/**
 * Whether the open vault keeps memory with cyber-brain (Plan 35), so the
 * Memory row shows only where there is a memory to show. Same query key as
 * the Memory screen's, so both read one answer.
 */
export function useMemoryKitActive(): boolean {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const { data } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'cyber-brain-config'],
    queryFn: () => loadCyberBrainConfig(),
    enabled: bridgeReady && graph !== null,
  })
  return data != null
}
