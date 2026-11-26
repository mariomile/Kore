import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  loadFirstLookRecentNotes,
  loadVaultFirstLook,
  loadVaultTally,
  type NoteListEntry,
  type VaultFirstLook,
  type VaultTally,
} from '@kore/core'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { getIndexProgress, subscribeIndexProgress, type IndexProgress } from '@/lib/index-progress'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'

/** How often the counters re-read while the first index fills. */
const TALLY_REFRESH_MS = 500
/** How often the arriving cards re-read: slower, each one renders a note. */
const CARDS_REFRESH_MS = 2_500
/**
 * How often the first look samples index progress. The store ticks once per
 * file — thousands of times on a first index — and re-rendering the page on
 * every tick would slow the very index it is showing.
 */
const PROGRESS_SAMPLE_MS = 250
/** How many cards arrive. */
const ARRIVAL_CARDS = 6

export interface VaultArrival {
  /** This open is the vault's first in Kore: the arrival hero and cards show. */
  arriving: boolean
  /** The first index is still filling the empty projection. */
  filling: boolean
  /** The running pass's progress, null when no pass runs. */
  progress: IndexProgress | null
  tally: VaultTally | undefined
  /** The newest notes, re-read as the index fills. Empty when not arriving. */
  recent: readonly NoteListEntry[]
  /** Open → index live, in ms; null until the vault is ready. */
  readyInMs: number | null
  /** Suggestions and checks, once the index can answer for the whole vault. */
  firstLook: VaultFirstLook | undefined
  firstLookError: boolean
}

/**
 * The vault's arrival, read live: counters and cards re-poll on a short
 * clock only while a first index fills an empty projection (the index's
 * own invalidation is throttled to seconds, too slow to watch a vault come
 * in), then settle into ordinary index queries. Suggestions and checks wait
 * for the projection to be complete, so they never report a half-read vault.
 */
export function useVaultArrival(): VaultArrival {
  const { graph, firstLook, indexReady } = useGraph()
  const bridgeReady = useBridgeReady()
  const progress = useSampledIndexProgress()
  const arriving = firstLook !== null && graph !== null && firstLook.root === graph.root
  const filling = progress?.fromEmpty === true
  const enabled = bridgeReady && graph !== null

  const { data: tally, refetch: refetchTally } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'first-look', 'tally'],
    queryFn: loadVaultTally,
    enabled,
    refetchInterval: filling ? TALLY_REFRESH_MS : false,
  })
  const { data: recent } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'first-look', 'recent'],
    queryFn: () => loadFirstLookRecentNotes(ARRIVAL_CARDS),
    enabled: enabled && arriving,
    refetchInterval: filling ? CARDS_REFRESH_MS : false,
  })
  // The last poll can land a beat before the pass ends: read the final
  // count once more when it does, so "ready" never shows a short tally.
  const wasFilling = useRef(filling)
  useEffect(() => {
    if (wasFilling.current && !filling) {
      void refetchTally()
    }
    wasFilling.current = filling
  }, [filling, refetchTally])
  const { data: look, isError } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'first-look', 'look'],
    queryFn: loadVaultFirstLook,
    enabled: enabled && indexReady && !filling,
  })

  return {
    arriving,
    filling,
    progress,
    tally,
    recent: recent ?? [],
    readyInMs:
      arriving && firstLook?.readyAt != null
        ? Math.max(0, firstLook.readyAt - firstLook.startedAt)
        : null,
    firstLook: look,
    firstLookError: isError,
  }
}

/** The index progress store, read at most every {@link PROGRESS_SAMPLE_MS}. */
function useSampledIndexProgress(): IndexProgress | null {
  const [progress, setProgress] = useState(getIndexProgress)
  useEffect(() => {
    let timer: number | null = null
    const unsubscribe = subscribeIndexProgress(() => {
      // The end of a pass shows at once; ticks within one wait their turn.
      if (getIndexProgress() === null) {
        setProgress(null)
        return
      }
      timer ??= window.setTimeout(() => {
        timer = null
        setProgress(getIndexProgress())
      }, PROGRESS_SAMPLE_MS)
    })
    return () => {
      unsubscribe()
      if (timer !== null) {
        window.clearTimeout(timer)
      }
    }
  }, [])
  return progress
}
