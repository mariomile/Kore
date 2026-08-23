import type { ReactElement } from 'react'
import {
  appendBodyTag,
  createNoteIfAbsent,
  errorMessage,
  untitledNotePath,
  untitledNoteSeed,
} from '@reflect/core'
import { toast } from '@/components/ui/toast'
import { keybindingFor, newNoteRoute } from '@/lib/commands/app-commands'
import { formatBindingLabel } from '@/lib/keybindings'
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
 * tag, so the new note is a member of the collection immediately.
 */
export function NewNoteButton({ tag = null }: NewNoteButtonProps): ReactElement {
  const { navigate } = useRouter()
  const { graph } = useGraph()

  const createTagged = async (activeTag: string): Promise<void> => {
    if (graph === null) {
      return
    }
    const path = untitledNotePath()
    const seed = untitledNoteSeed()
    try {
      await createNoteIfAbsent(path, appendBodyTag(seed, activeTag) ?? seed, graph.generation)
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
      className="flex items-center gap-2 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-text-on-brand shadow-sm transition-colors duration-100 hover:bg-accent-hover"
    >
      New note
      {NEW_NOTE_BINDING !== null ? (
        <span aria-hidden className="rounded bg-white/20 px-1 py-px text-[11px] font-medium">
          {formatBindingLabel(NEW_NOTE_BINDING)}
        </span>
      ) : null}
    </button>
  )
}
