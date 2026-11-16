import { useQuery } from '@tanstack/react-query'
import {
  listNoteTags,
  listTagTypes,
  suggestTypeTag,
  tagUseCount,
  type TypeTagSuggestion,
} from '@kore/core'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { allNotesTagsQueryKey } from '@/lib/notes/all-notes-query'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'

export interface TypeTagBinding {
  /** Notes carrying the type's own tag. */
  count: number | null
  /** A tag ending in the same name that more notes carry (`type/project`). */
  suggestion: TypeTagSuggestion | null
}

/**
 * What a type's tag collects, for the settings header: its own note count
 * and, when the vault nests its kinds, the tag the notes actually use
 * (`suggestTypeTag` decides; this only reads the two lists it needs).
 */
export function useTypeTagBinding(tag: string): TypeTagBinding {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const enabled = bridgeReady && graph !== null
  const { data: noteTags } = useQuery({
    queryKey: allNotesTagsQueryKey(graph?.root),
    queryFn: () => listNoteTags(),
    enabled,
  })
  const { data: tagTypes } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'tag-types'],
    queryFn: () => listTagTypes(),
    enabled,
  })
  if (noteTags === undefined) {
    return { count: null, suggestion: null }
  }
  return {
    count: tagUseCount(tag, noteTags),
    suggestion: suggestTypeTag(
      tag,
      noteTags,
      (tagTypes ?? []).map((entry) => entry.tagKey),
    ),
  }
}
