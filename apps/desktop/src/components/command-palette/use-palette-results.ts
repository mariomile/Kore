import { useDeferredValue, useEffect, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { parseSearchQuery, retrieve, searchWithFilters, suggestWikiTargets } from '@reflect/core'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { listCommands } from '@/lib/commands/registry'
import { todayIso } from '@/lib/dates'
import { ensureEmbeddingsVisibly } from '@/lib/semantic'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useEmbedStatus } from '@/lib/use-embed-status'
import { useGraph } from '@/providers/graph-provider'
import { useSettings } from '@/providers/settings-provider'
import { buildPaletteSections, type PaletteSections } from './entries'

/**
 * The palette's data layer (Plan 08), extracted so the component stays
 * presentational: title suggestions, immediate lexical results, and a delayed
 * hybrid upgrade. Native hybrid work is serialized; superseded queries are
 * discarded before admission rather than consuming embedding capacity.
 */

export interface PaletteResults {
  sections: PaletteSections
  /** True once the index has answered the *live* query (gates "No results"). */
  resultsSettled: boolean
  /** True when an index read errored — "No results" would be a lie. */
  searchFailed: boolean
}

export function usePaletteResults(open: boolean, query: string): PaletteResults {
  const { graph } = useGraph()
  // Hybrid needs both halves of the opt-in: the setting on *and* the model
  // ready. The setting gate makes disabling immediate — the model stays loaded
  // until it idles out, but its results must not. Plain-text queries blend
  // semantic hits via RRF and degrade invisibly to lexical without either.
  // Filtered queries stay constraint-based — filters are exact by nature.
  const { settings } = useSettings()
  const embed = useEmbedStatus()
  const hybrid = settings.semanticSearchEnabled && embed.status === 'ready'
  const activeHybrid = useRef<Promise<unknown> | null>(null)

  // Keep expensive result rendering behind input; semantic admission has its
  // own debounce because useDeferredValue does not bound request production.
  const trimmed = useDeferredValue(query.trim())
  // Filter tokens (#tag, is:daily, is:pinned, links:, linked-from:, updated:)
  // switch the search into constrained mode (Plan 08b); plain text is the same
  // query with empty filters — one search path.
  const parsed = useMemo(() => parseSearchQuery(trimmed), [trimmed])
  const bridgeReady = useBridgeReady()
  const searching = open && bridgeReady && graph !== null && !trimmed.startsWith('>')
  // The generated date suggestions are relative to today, so the calendar day is
  // part of the cache identity — without it a palette cached before midnight
  // would serve a stale "Tomorrow" afterwards. Computed once so the key and the
  // query agree on the same day.
  const today = todayIso()

  const {
    data: suggestions,
    isLoading: suggestionsLoading,
    isError: suggestionsError,
  } = useQuery({
    queryKey: [
      INDEX_QUERY_SCOPE,
      graph?.root,
      'palette-suggest',
      trimmed,
      settings.dateFormat,
      settings.weekStartDay,
      today,
    ],
    queryFn: () =>
      suggestWikiTargets(trimmed, 8, {
        today,
        dateFormat: settings.dateFormat,
        weekStartDay: settings.weekStartDay,
      }),
    enabled: searching && !parsed.filtered,
  })
  const useHybrid = hybrid && !parsed.filtered
  // A model released after idling comes back on the first real search, not on
  // every palette open: this query stays lexical while it loads, and re-runs
  // as hybrid the moment `ready` lands — the hybrid flag is part of its key.
  const reloadIdleModel =
    settings.semanticSearchEnabled &&
    embed.status === 'unloaded' &&
    searching &&
    trimmed !== '' &&
    !parsed.filtered
  useEffect(() => {
    if (reloadIdleModel) {
      void ensureEmbeddingsVisibly()
    }
  }, [reloadIdleModel])
  const {
    data: lexicalHits,
    isLoading: hitsLoading,
    isError: hitsError,
  } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'palette-search', 'lexical', trimmed],
    queryFn: () => searchWithFilters(parsed),
    enabled: searching && trimmed !== '',
  })
  const semanticQuery = searching && useHybrid && trimmed !== '' ? trimmed : null
  const { data: hybridHits, isLoading: hybridLoading } = useQuery({
    queryKey: [
      INDEX_QUERY_SCOPE,
      graph?.root,
      'palette-search',
      'hybrid',
      graph?.generation,
      semanticQuery,
    ],
    queryFn: async ({ signal }) => {
      // Consuming the query signal makes key changes (including close/disable)
      // cancel obsolete consumers. Already admitted native work must finish,
      // so keep its actual promise until completion even after cancellation.
      await new Promise((resolve) => setTimeout(resolve, 180))
      signal.throwIfAborted()
      while (activeHybrid.current !== null) {
        await activeHybrid.current.catch(() => {})
        signal.throwIfAborted()
      }
      const request = retrieve(trimmed, { mode: 'hybrid' })
      activeHybrid.current = request
      try {
        const hits = await request
        return hits.map((hit) => ({
          path: hit.path,
          title: hit.title,
          dailyDate: null,
          snippet: hit.snippet === '' ? null : hit.snippet,
        }))
      } finally {
        activeHybrid.current = null
      }
    },
    enabled: semanticQuery !== null,
  })
  const hits = hybridHits ?? lexicalHits

  // "No results" must mean the index answered **the live query**: the active
  // fetches settled (isLoading, not isPending — a disabled query is forever
  // pending) *and* the deferred value has caught up. Opening pre-filled, the
  // deferred value can settle on the stale previous query first; that state
  // is "still answering", not "empty".
  const resultsSettled =
    !suggestionsLoading && !hitsLoading && !hybridLoading && trimmed === query.trim()
  // An errored query is "settled" to TanStack but not an answer.
  const searchFailed = suggestionsError || (hybridHits === undefined && hitsError)

  const sections = useMemo(
    () =>
      buildPaletteSections({
        query,
        dataQuery: trimmed,
        suggestions: suggestions ?? [],
        hits: hits ?? [],
        filtered: parsed.filtered,
        commands: listCommands(),
      }),
    [query, trimmed, suggestions, hits, parsed.filtered],
  )

  return { sections, resultsSettled, searchFailed }
}
