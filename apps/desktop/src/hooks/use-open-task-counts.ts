import { use, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { countOpenTasksForNotes } from '@reflect/core'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { GraphContext } from '@/providers/graph-context'

const NO_COUNTS: Record<string, number> = {}

/**
 * Open-task counts for a set of notes (collection rows): written in the
 * note, or a task line linking it — the tag-page/project membership rule.
 * Empty until the query settles; notes with no open tasks stay absent, so
 * `counts[path] ?? 0` is the read. Under the index scope, watcher batches
 * refresh it as tasks complete. The graph context is read optionally so
 * the collection views stay mountable bare (their tests do).
 */
export function useOpenTaskCounts(paths: readonly string[]): Record<string, number> {
  const graph = use(GraphContext)?.graph ?? null
  const bridgeReady = useBridgeReady()
  // Row order changes (sorts) must not refetch: key on the sorted set.
  const pathsKey = useMemo(() => [...paths].sort().join('\n'), [paths])
  const { data } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'open-task-counts', pathsKey],
    queryFn: () => countOpenTasksForNotes(paths),
    enabled: bridgeReady && graph !== null && paths.length > 0,
  })
  return data ?? NO_COUNTS
}
