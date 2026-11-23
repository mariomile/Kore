import { useQuery } from '@tanstack/react-query'
import { foldTag, listNotesWithProperty, optionUseCounts, propertyRowValue } from '@kore/core'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'

/**
 * How many of a type's notes use each option of the property stored under
 * `key` (null for a property that was never saved: nothing uses it).
 * `undefined` while the count is still loading, so a caller can stay on the
 * safe side and treat every stored option as in use.
 */
export function useOptionUsage(
  tag: string,
  key: string | null,
): ReadonlyMap<string, number> | undefined {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const { data } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'option-usage', foldTag(tag), key],
    queryFn: async () => {
      const notes = await listNotesWithProperty(key ?? '', { tag })
      return optionUseCounts(notes.map((note) => propertyRowValue(note.value)))
    },
    enabled: key !== null && bridgeReady && graph !== null,
  })
  return key === null ? NO_USES : data
}

const NO_USES: ReadonlyMap<string, number> = new Map()
