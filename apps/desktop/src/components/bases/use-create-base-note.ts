import { useCallback } from 'react'
import {
  baseNoteFitsView,
  createBaseNote,
  errorMessage,
  type BaseDefinition,
  type BaseNewNotePrefill,
} from '@reflect/core'
import { toast } from '@/components/ui/toast'
import { invalidateOnNextIndexApply } from '@/lib/tags/use-commit-note-property'
import { useGraph } from '@/providers/graph-provider'

/** Create a note titled `title` with `prefill`; resolves true once the file is written. */
export type BaseCreateHandler = (title: string, prefill: BaseNewNotePrefill) => Promise<boolean>

/** The view notes are created from. */
export interface BaseCreateTarget {
  readonly definition: BaseDefinition
  readonly viewIndex: number
}

/**
 * A base's "+ New": writes the note through core and refreshes the view as
 * soon as its re-index lands, so the new row shows up in place. When the
 * view's other filters leave the new note out, a notice says so and offers
 * to open it. A failed write toasts and resolves false, so the typed title
 * stays.
 */
export function useCreateBaseNote(
  target: BaseCreateTarget | null,
  onOpenNote: (path: string) => void,
): BaseCreateHandler {
  const { graph } = useGraph()
  const generation = graph?.generation ?? null
  return useCallback(
    async (title: string, prefill: BaseNewNotePrefill) => {
      if (generation === null) {
        return false
      }
      let path: string
      try {
        path = await createBaseNote(title, prefill, generation)
      } catch (error) {
        toast.add({
          type: 'error',
          title: "Couldn't create the note",
          description: errorMessage(error),
        })
        return false
      }
      invalidateOnNextIndexApply()
      const note = { path, title, properties: prefill.properties, tags: prefill.tags }
      if (
        target !== null &&
        !baseNoteFitsView(target.definition, target.viewIndex, note, Date.now())
      ) {
        const id = toast.add({
          title: `Created “${title}”`,
          description: 'It doesn’t match this view’s filters, so it isn’t listed here.',
          timeout: 10_000,
          actionProps: {
            children: 'Open',
            onClick: () => {
              toast.close(id)
              onOpenNote(path)
            },
          },
        })
      }
      return true
    },
    [generation, target, onOpenNote],
  )
}
