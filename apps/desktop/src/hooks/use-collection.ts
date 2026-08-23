import { useQuery } from '@tanstack/react-query'
import { foldTag, listCollection, type CollectionEntry, type CollectionSort } from '@reflect/core'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'

/** Query key for a tag's collection rows, per sort — under the index scope. */
export function collectionQueryKey(
  root: string | undefined,
  tag: string,
  sort: CollectionSort | null,
): readonly [string, string | undefined, string, string, string | null, string | null] {
  return [
    INDEX_QUERY_SCOPE,
    root,
    'collection',
    foldTag(tag),
    sort?.key ?? null,
    sort?.direction ?? null,
  ]
}

/**
 * The Collection rows for a typed tag (TDR 0005): the notes carrying the tag
 * with their indexed frontmatter values. `undefined` while the query settles.
 */
export function useCollection(
  tag: string | null,
  sort: CollectionSort | null,
): CollectionEntry[] | undefined {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const { data } = useQuery({
    queryKey: collectionQueryKey(graph?.root, tag ?? '', sort),
    queryFn: () => listCollection(tag ?? '', sort),
    enabled: bridgeReady && graph !== null && tag !== null,
  })
  return data
}
