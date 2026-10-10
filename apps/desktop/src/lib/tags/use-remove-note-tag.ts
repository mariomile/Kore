import { useCallback } from 'react'
import { errorMessage, removeNoteTag } from '@reflect/core'
import { toast } from '@/components/ui/toast'
import { commitNoteBodyTransform } from '@/lib/note-frontmatter'
import { useGraph } from '@/providers/graph-provider'
import { invalidateOnNextIndexApply } from './use-commit-note-property'

/**
 * Unset a typed tag on a note: clear it from frontmatter `tags:` and strip
 * every `#tag` token from the body, so the note leaves that collection
 * whichever source put it there. The Type field's remove chip is the UI;
 * this is the write.
 */
export function useRemoveNoteTag(): (path: string, tag: string) => void {
  const { graph } = useGraph()
  const generation = graph?.generation ?? null
  return useCallback(
    (path: string, tag: string) => {
      if (generation === null) {
        return
      }
      void commitNoteBodyTransform(
        path,
        (source) => removeNoteTag(source, tag) ?? source,
        generation,
      )
        .then(() => {
          invalidateOnNextIndexApply()
        })
        .catch((error: unknown) => {
          toast.add({
            type: 'error',
            title: "Couldn't remove the type",
            description: errorMessage(error),
          })
        })
    },
    [generation],
  )
}
