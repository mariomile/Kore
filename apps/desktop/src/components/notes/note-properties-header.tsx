import type { ReactElement } from 'react'
import { PropertyFieldValue } from '@/components/tags/property-field-value'
import { PropertyValueEditor } from '@/components/tags/property-editors'
import { useCommitNoteProperty } from '@/lib/tags/use-commit-note-property'
import { useNoteTypedProperties } from '@/lib/tags/use-note-typed-properties'
import { useOpenRelation } from '@/lib/tags/use-open-relation'

interface NotePropertiesHeaderProps {
  /** Graph-relative path of the note the pane is editing. */
  path: string
}

/**
 * The row page's fields (Plan 29 N1): a note carrying a typed tag presents
 * its properties below the title and above the body, each editable in place through the same
 * per-type editors the Collection table and the context rail use — one write
 * channel, three surfaces. Renders nothing while the note carries no typed
 * tag, so ordinary notes keep their clean top edge.
 */
export function NotePropertiesHeader({ path }: NotePropertiesHeaderProps): ReactElement | null {
  const commitProperty = useCommitNoteProperty()
  const openRelation = useOpenRelation()
  const { properties, values } = useNoteTypedProperties(path)

  if (properties.length === 0) {
    return null
  }

  return (
    <section aria-label="Properties" className="mb-5 border-b border-border pb-4">
      <ul className="space-y-0.5">
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
