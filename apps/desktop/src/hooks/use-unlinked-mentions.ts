import { useCallback, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getUnlinkedMentions, linkUnlinkedMention, type UnlinkedMention } from '@reflect/core'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { INDEX_QUERY_SCOPE, invalidateIndexQueries } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'

/** What the unlinked-mentions section renders, plus the one action it offers. */
export interface UnlinkedMentions {
  mentions: UnlinkedMention[]
  isLoading: boolean
  /**
   * Convert one mention into a wiki link. Resolves when the write landed (or
   * the occurrence was gone); the index write-echo then refreshes every
   * index query, which drops the row from this panel and adds it to
   * Backlinks. Rejections surface as the row's inline error.
   */
  link: (mention: UnlinkedMention) => Promise<void>
  /** Source paths with a link conversion in flight (disable their button). */
  linking: ReadonlySet<string>
  /** Source paths whose last conversion attempt failed. */
  linkFailed: ReadonlySet<string>
}

/**
 * The unlinked-mentions data layer: notes whose prose names this note's
 * title without linking to it, and the one-click conversion that turns the
 * mention into a real `[[wiki link]]`. Keyed like every index query (graph
 * root included) so a graph switch never serves the previous graph's rows.
 */
export function useUnlinkedMentions(path: string): UnlinkedMentions {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const [linking, setLinking] = useState<ReadonlySet<string>>(new Set())
  const [linkFailed, setLinkFailed] = useState<ReadonlySet<string>>(new Set())

  const { data, isPending } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'unlinked-mentions', path],
    queryFn: () => getUnlinkedMentions(path),
    enabled: bridgeReady && graph !== null,
  })

  const generation = graph?.generation
  const link = useCallback(
    async (mention: UnlinkedMention): Promise<void> => {
      if (generation === undefined) {
        return
      }
      setLinkFailed((failed) => without(failed, mention.sourcePath))
      setLinking((current) => withPath(current, mention.sourcePath))
      try {
        await linkUnlinkedMention({
          sourcePath: mention.sourcePath,
          targetTitle: mention.targetTitle,
          generation,
        })
        // The write-echo reindexes the source note; refetch now rather than
        // waiting on the batching so the row moves to Backlinks promptly.
        invalidateIndexQueries()
      } catch {
        setLinkFailed((failed) => withPath(failed, mention.sourcePath))
      } finally {
        setLinking((current) => without(current, mention.sourcePath))
      }
    },
    [generation],
  )

  return {
    mentions: data ?? [],
    isLoading: isPending,
    link,
    linking,
    linkFailed,
  }
}

function withPath(set: ReadonlySet<string>, path: string): ReadonlySet<string> {
  const next = new Set(set)
  next.add(path)
  return next
}

function without(set: ReadonlySet<string>, path: string): ReadonlySet<string> {
  if (!set.has(path)) {
    return set
  }
  const next = new Set(set)
  next.delete(path)
  return next
}
