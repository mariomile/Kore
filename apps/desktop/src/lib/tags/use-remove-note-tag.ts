import { useCallback } from 'react'
import { errorMessage, removeBodyTag } from '@reflect/core'
import { toast } from '@/components/ui/toast'
import { commitNoteBodyTransform } from '@/lib/note-frontmatter'
import { useGraph } from '@/providers/graph-provider'
import { invalidateOnNextIndexApply } from './use-commit-note-property'

/**
 * Unset a typed tag on a note (TDR 0005: the hashtag is the supertag): strip
 * every `#tag` token from the body so the note leaves that collection. The
 * Type field's remove chip is the UI; this is the write.
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
        (source) => removeBodyTag(source, tag) ?? source,
        generation,
      )
        .then(() => {
          invalidateOnNextIndexApply()
        })
        .catch((error: unknown) => {
          toast.add({
            type: 'error',
            title: "Couldn't remove the tag",
            description: errorMessage(error),
          })
        })
    },
    [generation],
  )
}
