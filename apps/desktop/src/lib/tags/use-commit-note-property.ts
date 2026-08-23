import { useCallback } from 'react'
import { errorMessage } from '@reflect/core'
import { toast } from '@/components/ui/toast'
import { commitNoteFrontmatter } from '@/lib/note-frontmatter'
import { useGraph } from '@/providers/graph-provider'

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
      void commitNoteFrontmatter(path, { properties: { [key]: value } }, generation).catch(
        (error: unknown) => {
          toast.add({
            type: 'error',
            title: "Couldn't save the property",
            description: errorMessage(error),
          })
        },
      )
    },
    [generation],
  )
}
