import { useQuery } from '@tanstack/react-query'
import { getTagType, foldTag, type TagType } from '@reflect/core'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'

/** Query key for one tag's type — under the index scope, so watcher batches
 * (including a synced edit of `tags/<key>.md`) refresh it for free. */
export function tagTypeQueryKey(
  root: string | undefined,
  tag: string,
): readonly [string, string | undefined, string, string] {
  return [INDEX_QUERY_SCOPE, root, 'tag-type', foldTag(tag)]
}

/**
 * The tag's schema from the `tag_types` projection, or `null` while the tag
 * is untyped (TDR 0005). `undefined` only before the first load resolves.
 */
export function useTagType(tag: string | null): TagType | null | undefined {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const { data } = useQuery({
    queryKey: tagTypeQueryKey(graph?.root, tag ?? ''),
    queryFn: () => getTagType(tag ?? ''),
    enabled: bridgeReady && graph !== null && tag !== null,
  })
  return tag === null ? null : data
}
