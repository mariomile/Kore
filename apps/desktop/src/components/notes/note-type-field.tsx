import type { ReactElement } from 'react'
import type { TagTypeEntry } from '@reflect/core'
import { Close } from '@/components/icons'
import { useRemoveNoteTag } from '@/lib/tags/use-remove-note-tag'
import { cn } from '@/lib/utils'

interface NoteTypeFieldProps {
  /** Graph-relative path of the note whose typed tags are shown. */
  path: string
  /** The note's typed tags, in key order. */
  tagTypes: readonly TagTypeEntry[]
  /** Width of the Type label — header uses `w-32`, the rail uses `w-24`. */
  labelClassName?: string
}

/**
 * The properties header's Type row: one chip per typed tag the note carries.
 * Removing a chip unsets that supertag (strips `#tag` from the body). Two
 * typed tags both appear; their schemas still union in the rows below, with
 * the first declaration winning on a shared key.
 */
export function NoteTypeField({
  path,
  tagTypes,
  labelClassName = 'w-32',
}: NoteTypeFieldProps): ReactElement | null {
  const removeTag = useRemoveNoteTag()

  if (tagTypes.length === 0) {
    return null
  }

  return (
    <li className="flex min-h-7 items-center gap-2">
      <span className={cn('shrink-0 truncate text-[13px] text-text-muted', labelClassName)}>
        Type
      </span>
      <ul className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {tagTypes.map((entry) => (
          <li key={entry.tagKey}>
            <span className="inline-flex max-w-full items-center gap-0.5 rounded-full border border-border bg-surface-hover py-0.5 pl-2 pr-0.5 text-[13px] text-text-secondary">
              <span className="truncate">#{entry.tagKey}</span>
              <button
                type="button"
                aria-label={`Remove #${entry.tagKey}`}
                className="flex size-5 shrink-0 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-sunken hover:text-text"
                onClick={() => {
                  removeTag(path, entry.tagKey)
                }}
              >
                <Close aria-hidden className="size-3" />
              </button>
            </span>
          </li>
        ))}
      </ul>
    </li>
  )
}
