import { useQuery } from '@tanstack/react-query'
import { dryRunObsidianImport, type GraphInfo, type ObsidianImportReport } from '@reflect/core'
import { checkRoundTrip } from '@/editor/roundtrip'
import { useBridgeReady } from '@/hooks/use-bridge-ready'

export interface ObsidianImportDryRunState {
  /** `undefined` until the first run; `null` when the vault has no Obsidian settings. */
  readonly report: ObsidianImportReport | null | undefined
  readonly isRunning: boolean
  readonly error: Error | null
  readonly run: () => void
}

/**
 * The dry run of converting the open vault to Kore's layout. It reads every
 * note and runs the editor's round-trip check on each, so it never starts by
 * itself: only {@link ObsidianImportDryRunState.run} does, and a graph switch
 * drops the result.
 */
export function useObsidianImportDryRun(graph: GraphInfo | null): ObsidianImportDryRunState {
  const bridgeReady = useBridgeReady()
  const { data, isFetching, error, refetch } = useQuery({
    queryKey: ['obsidian-import-dry-run', graph?.root, graph?.generation] as const,
    queryFn: async () => {
      if (graph === null || !bridgeReady) {
        throw new Error('no graph is open')
      }
      return await dryRunObsidianImport(graph.generation, checkRoundTrip)
    },
    enabled: false,
    staleTime: Infinity,
    retry: false,
  })
  return {
    report: data,
    isRunning: isFetching,
    error,
    run: () => void refetch(),
  }
}
