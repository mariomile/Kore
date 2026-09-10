import { useQuery } from '@tanstack/react-query'
import {
  listReusableCollection,
  listNotes,
  resolveCollectionDefinition,
  type CollectionDefinition,
  type CollectionDiagnostic,
  type CollectionEntry,
  type CollectionPropertySchema,
  type CollectionSort,
  type NoteListEntry,
} from '@reflect/core'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'

export type ReusableCollectionState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'unresolved'; readonly reference: string }
  | {
      readonly status: 'ambiguous'
      readonly reference: string
      readonly candidates: readonly string[]
    }
  | {
      readonly status: 'resolved'
      readonly definition: CollectionDefinition
      readonly rows: readonly CollectionEntry[]
      readonly schema: CollectionPropertySchema
      readonly diagnostics: readonly CollectionDiagnostic[]
      readonly notes: readonly NoteListEntry[]
    }

/** Resolve and query one reusable collection definition for an inline view. */
export function useReusableCollection(
  reference: string,
  sorts: readonly CollectionSort[],
): ReusableCollectionState {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const query = useQuery({
    queryKey: [
      INDEX_QUERY_SCOPE,
      graph?.root,
      'reusable-collection',
      reference,
      sorts.map((sort) => `${sort.key}:${sort.direction}`).join(','),
    ],
    enabled: bridgeReady && graph !== null,
    queryFn: async (): Promise<ReusableCollectionState> => {
      const resolution = await resolveCollectionDefinition(reference)
      if (resolution.status !== 'resolved') {
        return resolution
      }
      const [result, notes] = await Promise.all([
        listReusableCollection(resolution.definition, sorts),
        listNotes(),
      ])
      return {
        status: 'resolved',
        definition: resolution.definition,
        rows: result.rows,
        schema: result.schema,
        diagnostics: result.diagnostics,
        notes,
      }
    },
  })

  if (query.error !== null) {
    return {
      status: 'error',
      message: query.error instanceof Error ? query.error.message : String(query.error),
    }
  }
  return query.data ?? { status: 'loading' }
}
