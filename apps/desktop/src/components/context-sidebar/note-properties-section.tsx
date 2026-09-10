import type { ReactElement } from 'react'
import { NoteTypeField } from '@/components/notes/note-type-field'
import { PropertyFieldValue } from '@/components/tags/property-field-value'
import { PropertyValueEditor } from '@/components/tags/property-editors'
import { useCommitNoteProperty } from '@/lib/tags/use-commit-note-property'
import { useNoteTypedProperties } from '@/lib/tags/use-note-typed-properties'
import { useOpenRelation } from '@/lib/tags/use-open-relation'
import { SidebarSection } from './sidebar-section'

interface NotePropertiesSectionProps {
  /** Graph-relative path of the note the sidebar describes. */
  path: string
}

/**
 * The note's properties (TDR 0005): Type (the supertag), the union of its tags'
 * schemas, then note-owned loose fields. Hidden only when the note has neither
 * a typed tag nor a stored property.
 */
export function NotePropertiesSection({ path }: NotePropertiesSectionProps): ReactElement | null {
  const commitProperty = useCommitNoteProperty()
  const openRelation = useOpenRelation()
  const { tagTypes, properties, values } = useNoteTypedProperties(path)

  if (tagTypes.length === 0 && properties.length === 0) {
    return null
  }

  return (
    <SidebarSection storageKey="note-properties" title="Properties">
      <ul className="space-y-0.5">
        <NoteTypeField path={path} tagTypes={tagTypes} labelClassName="w-24" />
        {properties.map((property) => (
          <li key={property.key} className="flex min-h-7 items-center gap-2">
            <span className="w-24 shrink-0 truncate text-[13px] text-text-muted">
              {property.name}
            </span>
            <PropertyValueEditor
              property={property}
              value={values?.[property.key]}
              onCommit={(value) => commitProperty(path, property.key, value)}
              onOpenRelation={openRelation}
              align="end"
            >
              <PropertyFieldValue property={property} value={values?.[property.key]} />
            </PropertyValueEditor>
          </li>
        ))}
      </ul>
    </SidebarSection>
  )
}
