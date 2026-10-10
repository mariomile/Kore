import { useQuery } from '@tanstack/react-query'
import { scanVaultCompat, type VaultCompatReport } from '@reflect/core'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { useGraph } from '@/providers/graph-provider'

/** The query key of the open vault's compatibility report (see {@link useVaultCompatReport}). */
export function vaultCompatQueryKey(root: string | undefined, generation: number | undefined) {
  return ['vault-compat', root, generation] as const
}

export interface VaultCompatReportState {
  readonly report: VaultCompatReport | null
  readonly isScanning: boolean
  readonly error: Error | null
  readonly rescan: () => void
}

/**
 * The open vault's compatibility report. A scan reads every note, so it runs
 * once per graph open and on an explicit rescan, never on index changes.
 */
export function useVaultCompatReport(enabled = true): VaultCompatReportState {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const { data, isFetching, error, refetch } = useQuery({
    queryKey: vaultCompatQueryKey(graph?.root, graph?.generation),
    queryFn: () => {
      if (graph === null) {
        throw new Error('no graph is open')
      }
      return scanVaultCompat(graph.generation)
    },
    enabled: enabled && bridgeReady && graph !== null,
    staleTime: Infinity,
    retry: false,
  })
  return {
    report: data ?? null,
    isScanning: isFetching,
    error,
    rescan: () => void refetch(),
  }
}
