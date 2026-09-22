import type { ReactElement } from 'react'
import type { NoteTagEntry } from '@reflect/core'
import { Close, Plus } from '@/components/icons'
import { TagIcon } from '@/components/tags/tag-icon'
import { useAddNoteTag } from '@/lib/tags/use-add-note-tag'
import { useRemoveNoteTag } from '@/lib/tags/use-remove-note-tag'
import { cn } from '@/lib/utils'
import { NoteTypePicker } from './note-type-picker'

interface NoteTypeFieldProps {
  /** Graph-relative path of the note whose tags are shown. */
  path: string
  /** Every tag the note carries, in key order. */
  tags: readonly NoteTagEntry[]
  /** Width of the Type label — header uses `w-32`, the rail uses `w-24`. */
  labelClassName?: string
}

/**
 * The properties header's Type row: one chip per tag the note carries, and a
 * picker that adds one. Choosing a type is the point — the note says what it
 * *is* through a field, the way every other piece of its metadata works,
 * instead of the user writing the hashtag into the prose. The write still
 * lands as `#tag` in the body (the hashtag is the supertag, TDR 0005) and the
 * editor collapses that line, so the round trip is invisible.
 *
 * Every tag shows, not only schema-bearing ones: since Amendment A a tag *is*
 * a collection whether or not a definition declares properties, and the
 * editor collapses a leading or trailing tag-only paragraph whenever this
 * header renders — so a tag missing from this row would be hidden with
 * nothing left to show it. Removing a chip strips `#tag` from the body.
 */
export function NoteTypeField({
  path,
  tags,
  labelClassName = 'w-32',
}: NoteTypeFieldProps): ReactElement {
  const addTag = useAddNoteTag()
  const removeTag = useRemoveNoteTag()
  const carried = tags.map((entry) => entry.tagKey)

  return (
    <li className="flex min-h-7 items-center gap-2">
      <span className={cn('shrink-0 truncate text-[13px] text-text-muted', labelClassName)}>
        Type
      </span>
      <ul className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {tags.map((entry) => (
          <li key={entry.tagKey}>
            <span className="inline-flex max-w-full items-center gap-0.5 rounded-full border border-border bg-surface-hover py-0.5 pl-2 pr-0.5 text-[13px] text-text-secondary">
              {entry.type?.icon !== undefined ? (
                <TagIcon
                  icon={entry.type.icon}
                  className="mr-0.5 size-3.5"
                  emojiClassName="mr-0.5"
                />
              ) : null}
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
        <li>
          <NoteTypePicker
            carried={carried}
            onChoose={(tag) => {
              void addTag(path, tag)
            }}
            triggerLabel={tags.length === 0 ? 'Set the type' : 'Add a type'}
            // Empty, the trigger *is* the field's value, so it reads as the
            // placeholder Notion-style pickers show; alongside chips it
            // shrinks to a quiet `+` that does not compete with them.
            triggerClassName={cn(
              'flex min-h-5 items-center gap-1 rounded-full text-[13px] text-text-muted transition-colors hover:text-text focus-visible:outline-none',
              tags.length === 0 ? 'px-0.5' : 'size-5 justify-center hover:bg-surface-hover',
            )}
          >
            {tags.length === 0 ? <span>Empty</span> : <Plus aria-hidden className="size-3.5" />}
          </NoteTypePicker>
        </li>
      </ul>
    </li>
  )
}
