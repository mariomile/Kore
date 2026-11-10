import type { ReactElement } from 'react'
import { NoteFieldList } from '@/components/notes/note-field-list'
import { useNoteTypedProperties } from '@/lib/tags/use-note-typed-properties'
import { SidebarSection } from './sidebar-section'

interface NotePropertiesSectionProps {
  /** Graph-relative path of the note the sidebar describes. */
  path: string
}

/**
 * The note's properties (TDR 0005): Type (the supertag, pickable), the union
 * of its tags' schemas, then note-owned loose fields. Hidden only when the
 * note carries neither a tag nor a stored property — unlike the properties
 * header, the rail does not advertise an empty Type row, because the note's
 * own page is where that offer belongs.
 */
export function NotePropertiesSection({ path }: NotePropertiesSectionProps): ReactElement | null {
  const fields = useNoteTypedProperties(path)
  const { tags, properties } = fields

  if (tags.length === 0 && properties.length === 0) {
    return null
  }

  return (
    <SidebarSection storageKey="note-properties" title="Properties">
      <NoteFieldList path={path} fields={fields} labelClassName="w-24" align="end" />
    </SidebarSection>
  )
}
