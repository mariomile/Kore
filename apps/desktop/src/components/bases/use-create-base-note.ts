import { useCallback } from 'react'
import { createBaseNote, errorMessage, type BaseNewNotePrefill } from '@reflect/core'
import { toast } from '@/components/ui/toast'
import { invalidateOnNextIndexApply } from '@/lib/tags/use-commit-note-property'
import { useGraph } from '@/providers/graph-provider'

/** Create a note titled `title` with `prefill`; resolves once the file is written. */
export type BaseCreateHandler = (title: string, prefill: BaseNewNotePrefill) => Promise<void>

/**
 * A base's "+ New": writes the note through core and refreshes the view as
 * soon as its re-index lands, so the new row shows up in place. A failed
 * write toasts.
 */
export function useCreateBaseNote(): BaseCreateHandler {
  const { graph } = useGraph()
  const generation = graph?.generation ?? null
  return useCallback(
    async (title: string, prefill: BaseNewNotePrefill) => {
      if (generation === null) {
        return
      }
      try {
        await createBaseNote(title, prefill, generation)
        invalidateOnNextIndexApply()
      } catch (error) {
        toast.add({
          type: 'error',
          title: "Couldn't create the note",
          description: errorMessage(error),
        })
      }
    },
    [generation],
  )
}
