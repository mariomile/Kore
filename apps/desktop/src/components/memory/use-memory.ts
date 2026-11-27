import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import {
  loadCyberBrainConfig,
  loadMemoryOverview,
  type CyberBrainConfig,
  type MemoryOverview,
} from '@kore/core'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'

/**
 * The Memory view's reads, shared by the Mac page and the iPhone screen so
 * both draw the same cache: the vault's cyber-brain config (null when it
 * runs none), then what the kit's files hold.
 */
export function useCyberBrainConfig(): UseQueryResult<CyberBrainConfig | null> {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  return useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'cyber-brain-config'],
    queryFn: () => loadCyberBrainConfig(),
    enabled: bridgeReady && graph !== null,
  })
}

export interface MemoryOverviewQuery {
  readonly data: MemoryOverview | undefined
  readonly isError: boolean
  /** Re-read the kit's files (after an undo). */
  readonly refresh: () => void
}

export function useMemoryOverview(
  config: CyberBrainConfig | null | undefined,
): MemoryOverviewQuery {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const queryClient = useQueryClient()
  const queryKey = [INDEX_QUERY_SCOPE, graph?.root, 'memory-overview']
  const { data, isError } = useQuery({
    queryKey,
    // Enabled only with a config; the guard keeps the type honest.
    queryFn: () =>
      config == null ? Promise.reject(new Error('no memory kit')) : loadMemoryOverview(config),
    enabled: bridgeReady && graph !== null && config != null,
  })
  return {
    data,
    isError,
    refresh: () => void queryClient.invalidateQueries({ queryKey }),
  }
}
