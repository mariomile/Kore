import type { ReactElement } from 'react'
import { isTemplatePath } from '@kore/core'
import { useNoteTypedProperties } from '@/lib/tags/use-note-typed-properties'
import { Plus } from '@/components/icons'
import { useAddNoteTag } from '@/lib/tags/use-add-note-tag'
import { NoteFieldList } from './note-field-list'
import { NoteTypePicker } from './note-type-picker'

interface NotePropertiesHeaderProps {
  /** Graph-relative path of the note the pane is editing. */
  path: string
}

/**
 * The row page's fields (Plan 29 N1): a note presents its Type (the
 * supertag, pickable and removable) then its properties below the title and
 * above the body, each editable in place through the same per-type editors the
 * Collection table and the context rail use — one write channel, three
 * surfaces. Loose stored properties remain editable on ordinary notes without
 * turning those notes into a type.
 *
 * A note with neither a type nor a property shows no rows at all: only a
 * quiet "Add a type" that appears while the pointer is on the title (or the
 * control has focus), the way Notion offers properties on a fresh page. So a
 * new note starts as a title and a body, and choosing what it *is* stays one
 * click away; `#type/...` in the prose and templates set it too. Daily notes are excluded by the caller
 * (a stream has no type) and templates here: a template's fields belong to
 * the notes it seeds, not to itself.
 */
export function NotePropertiesHeader({ path }: NotePropertiesHeaderProps): ReactElement | null {
  const addTag = useAddNoteTag()
  const fields = useNoteTypedProperties(path)
  const { tags, properties } = fields

  if (isTemplatePath(path)) {
    return null
  }

  if (tags.length === 0 && properties.length === 0) {
    // Revealed by index.css while the title is hovered or the control is
    // focused or open; it keeps its height either way so the body never
    // shifts under the pointer.
    return (
      <section aria-label="Properties" data-bare-properties="" className="mb-0">
        <NoteTypePicker
          carried={[]}
          onChoose={(tag) => {
            void addTag(path, tag)
          }}
          triggerLabel="Add a type"
          triggerClassName="kore-note-add-type flex min-h-6 items-center gap-1 rounded-md px-1 text-[13px] text-text-muted transition-[opacity,color,background-color] duration-150 hover:bg-surface-hover hover:text-text"
        >
          <Plus aria-hidden className="size-3.5" />
          <span>Add a type</span>
        </NoteTypePicker>
      </section>
    )
  }

  return (
    <section aria-label="Properties" className="mb-5 border-b border-border pb-4">
      <NoteFieldList path={path} fields={fields} labelClassName="w-32" />
    </section>
  )
}
