import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { displayNoteTitle, getNote, isNoteTab, noteFileStem, type OpenNoteTab } from '@reflect/core'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'
import { useOpenTabs } from '@/providers/open-tabs-provider'

/** A tab joined with what its surfaces render. */
export interface OpenTabNote extends OpenNoteTab {
  /** Display title from the index; the file stem while the row is loading. */
  title: string
}

/**
 * The open tabs with their display titles, shared by the strip and the
 * sidebar's Open section. Titles come from the index (one cheap row lookup
 * per tab, refreshed by the usual index invalidation). Healing lives here
 * too: a tab whose note vanished from the index — renamed away or deleted —
 * is pruned, but never while the graph is still indexing, when absence just
 * means "not read yet".
 */
export function useOpenTabNotes(): OpenTabNote[] {
  const { tabs, pruneTab } = useOpenTabs()
  const { graph, indexing } = useGraph()
  const bridgeReady = useBridgeReady()
  const noteTabs = useMemo(() => tabs.filter(isNoteTab), [tabs])
  const paths = useMemo(() => noteTabs.map((tab) => tab.path), [noteTabs])

  const { data: rows, isSuccess } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'open-tab-notes', paths],
    queryFn: async () => {
      const found = await Promise.all(paths.map((path) => getNote(path)))
      return new Map(paths.map((path, index) => [path, found[index] ?? null]))
    },
    enabled: bridgeReady && graph !== null && paths.length > 0,
  })

  useEffect(() => {
    if (!isSuccess || rows === undefined || indexing) {
      return
    }
    for (const path of paths) {
      if (rows.get(path) === null) {
        pruneTab(path)
      }
    }
  }, [isSuccess, rows, indexing, paths, pruneTab])

  return useMemo(
    () =>
      noteTabs.map((tab) => ({
        ...tab,
        title: displayNoteTitle(rows?.get(tab.path)?.title ?? noteFileStem(tab.path)),
      })),
    [noteTabs, rows],
  )
}
