import type { ReactElement } from 'react'
import { PropertyFieldLabel } from '@/components/notes/property-field-label'
import { PropertyFieldValue } from '@/components/tags/property-field-value'
import { PropertyValueEditor } from '@/components/tags/property-editors'
import { useCommitNoteProperty } from '@/lib/tags/use-commit-note-property'
import type { NoteTypedProperties } from '@/lib/tags/use-note-typed-properties'
import { useOpenRelation } from '@/lib/tags/use-open-relation'
import { NoteTypeField } from './note-type-field'

interface NoteFieldListProps {
  /** Graph-relative path of the note whose fields are listed. */
  path: string
  fields: NoteTypedProperties
  /** Width of the label column: the header uses `w-32`, the rail `w-24`. */
  labelClassName: string
  /** Which edge the value editors' popovers align to. */
  align?: 'start' | 'end'
}

/**
 * A note's fields as rows: the Type row, then each property with its typed
 * label and in-place editor. The one list both the properties header and the
 * context rail render, so the two surfaces cannot drift apart.
 */
export function NoteFieldList({
  path,
  fields: { tags, properties, values, ownerTagOf },
  labelClassName,
  align,
}: NoteFieldListProps): ReactElement {
  const commitProperty = useCommitNoteProperty()
  const openRelation = useOpenRelation()
  return (
    <ul className="space-y-0.5">
      <NoteTypeField path={path} tags={tags} labelClassName={labelClassName} />
      {properties.map((property) => (
        <li key={property.key} className="flex min-h-7 items-center gap-2">
          <PropertyFieldLabel
            property={property}
            ownerTag={ownerTagOf(property.key)}
            className={labelClassName}
          />
          <PropertyValueEditor
            property={property}
            value={values?.[property.key]}
            onCommit={(value) => commitProperty(path, property.key, value)}
            onOpenRelation={openRelation}
            {...(align === undefined ? {} : { align })}
          >
            <PropertyFieldValue
              property={property}
              value={values?.[property.key]}
              onOpenRelation={openRelation}
            />
          </PropertyValueEditor>
        </li>
      ))}
    </ul>
  )
}
