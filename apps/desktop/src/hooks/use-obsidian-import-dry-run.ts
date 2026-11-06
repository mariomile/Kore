import { useDeferredValue, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  buildObsidianImportReport,
  importMappingFromLayout,
  readObsidianImportSource,
  type GraphInfo,
  type ImportFidelity,
  type ImportMapping,
  type ObsidianImportReport,
  type ObsidianImportSource,
} from '@reflect/core'
import { checkRoundTrip } from '@/editor/roundtrip'
import { useBridgeReady } from '@/hooks/use-bridge-ready'

export interface ObsidianImportDryRunState {
  /** `undefined` until the first run; `null` when the vault has no Obsidian settings. */
  readonly source: ObsidianImportSource | null | undefined
  /** The report for the current mapping; `undefined` until the vault has been read. */
  readonly report: ObsidianImportReport | undefined
  /** The mapping being previewed: the vault's own settings until the user edits it. */
  readonly mapping: ImportMapping | undefined
  readonly setMapping: (mapping: ImportMapping) => void
  readonly isRunning: boolean
  readonly error: Error | null
  readonly run: () => void
}

/**
 * The dry run of converting the open vault to Kore's layout. Reading the
 * vault is the slow part, so it never starts by itself: only
 * {@link ObsidianImportDryRunState.run} does, and a graph switch drops the
 * result. The report is rebuilt from what was read whenever the mapping
 * changes, reusing each note's round-trip verdict while its text is the same.
 */
export function useObsidianImportDryRun(graph: GraphInfo | null): ObsidianImportDryRunState {
  const bridgeReady = useBridgeReady()
  const { data, isFetching, error, refetch } = useQuery({
    queryKey: ['obsidian-import-dry-run', graph?.root, graph?.generation] as const,
    queryFn: async () => {
      if (graph === null || !bridgeReady) {
        throw new Error('no graph is open')
      }
      return await readObsidianImportSource(graph.generation)
    },
    enabled: false,
    staleTime: Infinity,
    retry: false,
  })

  // The edited mapping belongs to the source it was made for: a new read
  // starts again from that vault's own settings.
  const [edited, setEdited] = useState<{
    readonly source: ObsidianImportSource
    readonly mapping: ImportMapping
  } | null>(null)
  const mapping = useMemo(() => {
    if (data === undefined || data === null) {
      return
    }
    return edited?.source === data ? edited.mapping : importMappingFromLayout(data.layout)
  }, [data, edited])
  const deferredMapping = useDeferredValue(mapping)

  const verdicts = useRef<{ source: unknown; byBody: Map<string, ImportFidelity> }>({
    source: undefined,
    byBody: new Map(),
  })
  const report = useMemo(() => {
    if (data === undefined || data === null || deferredMapping === undefined) {
      return
    }
    if (verdicts.current.source !== data) {
      verdicts.current = { source: data, byBody: new Map() }
    }
    const { byBody } = verdicts.current
    return buildObsidianImportReport({
      mapping: deferredMapping,
      source: data,
      classify: (body) => {
        let verdict = byBody.get(body)
        if (verdict === undefined) {
          verdict = checkRoundTrip(body)
          byBody.set(body, verdict)
        }
        return verdict
      },
    })
  }, [data, deferredMapping])

  return {
    source: data,
    report,
    mapping,
    setMapping: (next) => {
      if (data !== undefined && data !== null) {
        setEdited({ source: data, mapping: next })
      }
    },
    isRunning: isFetching,
    error,
    run: () => void refetch(),
  }
}
