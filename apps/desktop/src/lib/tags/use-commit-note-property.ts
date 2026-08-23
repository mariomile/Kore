import { useCallback } from 'react'
import { errorMessage, subscribeIndexApplied } from '@reflect/core'
import { toast } from '@/components/ui/toast'
import { commitNoteFrontmatter } from '@/lib/note-frontmatter'
import { invalidateIndexQueries } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'

/**
 * Refresh the index-backed queries as soon as the *next* applied batch lands
 * — the write's own re-index. The streaming path throttles invalidations
 * (3s window), which is right for sync bursts but leaves a just-edited cell
 * stale mid-editing-burst; a direct user action deserves the immediate
 * refresh, and post-apply is the first moment a refetch can see the new row.
 * The subscription self-cleans after one batch (or a 5s safety timeout, for
 * a write the indexer coalesced into nothing).
 */
function invalidateOnNextIndexApply(): void {
  const cleanup = (): void => {
    clearTimeout(timeout)
    unsubscribe()
  }
  const unsubscribe = subscribeIndexApplied(() => {
    cleanup()
    invalidateIndexQueries()
  })
  const timeout = setTimeout(cleanup, 5_000)
}

/**
 * Persist one property value into a note's frontmatter (TDR 0005): the
 * shared commit for Collection cells and the note properties panel. Routes
 * through the session-or-disk patch channel; the reserved-key guard lives in
 * `frontmatterPatchToYaml`, so no caller can clobber app metadata. The
 * watcher's re-index refreshes every reader; a failed write toasts.
 */
export function useCommitNoteProperty(): (path: string, key: string, value: unknown) => void {
  const { graph } = useGraph()
  const generation = graph?.generation ?? null
  return useCallback(
    (path: string, key: string, value: unknown) => {
      if (generation === null) {
        return
      }
      void commitNoteFrontmatter(path, { properties: { [key]: value } }, generation)
        .then(() => {
          invalidateOnNextIndexApply()
        })
        .catch((error: unknown) => {
          toast.add({
            type: 'error',
            title: "Couldn't save the property",
            description: errorMessage(error),
          })
        })
    },
    [generation],
  )
}
