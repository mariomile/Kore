import type { ReactElement } from 'react'
import { isTemplatePath } from '@reflect/core'
import { PropertyFieldValue } from '@/components/tags/property-field-value'
import { PropertyValueEditor } from '@/components/tags/property-editors'
import { useCommitNoteProperty } from '@/lib/tags/use-commit-note-property'
import { useNoteTypedProperties } from '@/lib/tags/use-note-typed-properties'
import { useOpenRelation } from '@/lib/tags/use-open-relation'
import { cn } from '@/lib/utils'
import { NoteTypeField } from './note-type-field'

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
 * The Type row shows even when the note has none, so choosing what a note
 * *is* is always one click from the title instead of something the user has
 * to know to type into the prose. Daily notes are excluded by the caller
 * (a stream has no type) and templates here: a template's fields belong to
 * the notes it seeds, not to itself.
 */
export function NotePropertiesHeader({ path }: NotePropertiesHeaderProps): ReactElement | null {
  const commitProperty = useCommitNoteProperty()
  const openRelation = useOpenRelation()
  const { tags, properties, values } = useNoteTypedProperties(path)

  if (isTemplatePath(path)) {
    return null
  }

  // With nothing but the empty Type row to show, the rule under it would read
  // as a divider on every note in the graph. The offer stays, the chrome goes.
  const bare = tags.length === 0 && properties.length === 0

  return (
    <section aria-label="Properties" className={cn('mb-5', !bare && 'border-b border-border pb-4')}>
      <ul className="space-y-0.5">
        <NoteTypeField path={path} tags={tags} />
        {properties.map((property) => (
          <li key={property.key} className="flex min-h-7 items-center gap-2">
            <span className="w-32 shrink-0 truncate text-[13px] text-text-muted">
              {property.name}
            </span>
            <PropertyValueEditor
              property={property}
              value={values?.[property.key]}
              onCommit={(value) => commitProperty(path, property.key, value)}
              onOpenRelation={openRelation}
            >
              <PropertyFieldValue property={property} value={values?.[property.key]} />
            </PropertyValueEditor>
          </li>
        ))}
      </ul>
    </section>
  )
}
