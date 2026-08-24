import type { ReactElement } from 'react'
import { errorMessage } from '@reflect/core'
import { toast } from '@/components/ui/toast'
import { useTemplateValues } from '@/hooks/use-template-values'
import { useTagType } from '@/hooks/use-tag-type'
import { keybindingFor, newNoteRoute } from '@/lib/commands/app-commands'
import { formatBindingLabel } from '@/lib/keybindings'
import { createTypedCollectionNote } from '@/lib/tags/create-collection-note'
import { useGraph } from '@/providers/graph-provider'
import { useRouter } from '@/routing/router'

const NEW_NOTE_BINDING = keybindingFor('note.new')

interface NewNoteButtonProps {
  /**
   * The screen's active tag filter. A note born inside a tag's list (or its
   * Collection) carries the tag from birth — it lands in the view the user
   * is looking at instead of vanishing into All. Null keeps ⌘N's lazy
   * create-on-first-keystroke contract.
   */
  tag?: string | null
}

/**
 * The All Notes header's primary action — the same fresh-note route as ⌘N
 * (created lazily on the first keystroke), with the binding taught inline.
 * Under a tag filter the file is created eagerly instead, seeded with the
 * tag (and the type's bound template, when it names one), so the new note
 * is a member of the collection immediately.
 */
export function NewNoteButton({ tag = null }: NewNoteButtonProps): ReactElement {
  const { navigate } = useRouter()
  const { graph } = useGraph()
  const tagType = useTagType(tag)
  const resolveTemplateValues = useTemplateValues()

  const createTagged = async (activeTag: string): Promise<void> => {
    if (graph === null) {
      return
    }
    try {
      const path = await createTypedCollectionNote(
        activeTag,
        graph.generation,
        {},
        tagType,
        await resolveTemplateValues(null),
      )
      navigate({ kind: 'note', path })
    } catch (error) {
      toast.add({
        type: 'error',
        title: "Couldn't create the note",
        description: errorMessage(error),
      })
    }
  }

  return (
    <button
      type="button"
      onClick={() => {
        if (tag === null) {
          navigate(newNoteRoute())
        } else {
          void createTagged(tag)
        }
      }}
      className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium text-text-secondary transition-colors duration-100 hover:bg-surface-hover hover:text-text"
    >
      New note
      {NEW_NOTE_BINDING !== null ? (
        <span aria-hidden className="rounded px-1 py-px text-[11px] font-medium text-text-muted">
          {formatBindingLabel(NEW_NOTE_BINDING)}
        </span>
      ) : null}
    </button>
  )
}
