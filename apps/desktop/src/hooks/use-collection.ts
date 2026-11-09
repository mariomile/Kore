import { useQuery } from '@tanstack/react-query'
import {
  attachFormulaColumns,
  attachReverseRelations,
  attachRollups,
  attachTimestampColumns,
  effectiveCollectionSorts,
  foldTag,
  getTagType,
  listCollection,
  listTagChildren,
  type CollectionEntry,
  type CollectionSort,
} from '@reflect/core'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'

/** Query key for a tag's collection rows, per sort — under the index scope. */
export function collectionQueryKey(
  root: string | undefined,
  tag: string,
  sorts: readonly CollectionSort[],
  ownOnly = false,
): readonly [string, string | undefined, string, string, string, string] {
  return [
    INDEX_QUERY_SCOPE,
    root,
    'collection',
    foldTag(tag),
    sorts.map((sort) => `${sort.key}:${sort.direction}`).join(','),
    ownOnly ? 'own' : 'all',
  ]
}

/**
 * The tags that build on `tag` (Plan 33 B2), folded and sorted: their notes
 * join the tag's collection unless the "only #tag" filter is on. Empty while
 * loading and for a tag nothing extends.
 */
export function useTagChildren(tag: string | null): readonly string[] {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const { data } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'tag-children', foldTag(tag ?? '')],
    queryFn: () => listTagChildren(tag ?? ''),
    enabled: bridgeReady && graph !== null && tag !== null,
  })
  return data ?? NO_CHILDREN
}

const NO_CHILDREN: readonly string[] = []

/**
 * The Collection rows for a typed tag (TDR 0005): the notes carrying the tag
 * with their indexed frontmatter values, plus the notes of tags that build
 * on it unless `ownOnly`. `undefined` while the query settles.
 */
export function useCollection(
  tag: string | null,
  sorts: readonly CollectionSort[],
  { ownOnly = false }: { ownOnly?: boolean } = {},
): CollectionEntry[] | undefined {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const { data } = useQuery({
    queryKey: collectionQueryKey(graph?.root, tag ?? '', sorts, ownOnly),
    queryFn: async () => {
      const type = await getTagType(tag ?? '')
      const rows = await listCollection(tag ?? '', effectiveCollectionSorts(type, sorts), {
        ownOnly,
      })
      if (type === null) {
        return rows
      }
      // Derived cells in reading order: rollups, then reverse columns, then
      // the mtime-backed timestamps, then formulas (last, so expressions can
      // read every derived cell) — all view-only, none written to frontmatter.
      return attachFormulaColumns(
        attachTimestampColumns(
          await attachReverseRelations(await attachRollups(rows, type), type),
          type,
        ),
        type,
      )
    },
    enabled: bridgeReady && graph !== null && tag !== null,
  })
  return data
}
