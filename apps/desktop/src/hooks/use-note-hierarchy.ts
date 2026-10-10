import { useQuery } from '@tanstack/react-query'
import { getNoteAncestors, getNoteChildren, type HierarchyNote } from '@reflect/core'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'

const NO_NOTES: readonly HierarchyNote[] = []

/**
 * The note's `up:` breadcrumb, root first ({@link getNoteAncestors}). Empty
 * while loading or when the note declares no parent. Index-scoped, so an
 * edited `up:` refreshes it through the usual invalidation.
 */
export function useNoteAncestors(path: string): readonly HierarchyNote[] {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const { data } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'note-ancestors', path],
    queryFn: () => getNoteAncestors(path),
    enabled: bridgeReady && graph !== null,
  })
  return data ?? NO_NOTES
}

/** The notes whose `up:` names this note, by title ({@link getNoteChildren}). */
export function useNoteChildren(path: string): readonly HierarchyNote[] {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const { data } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'note-children', path],
    queryFn: () => getNoteChildren(path),
    enabled: bridgeReady && graph !== null,
  })
  return data ?? NO_NOTES
}
