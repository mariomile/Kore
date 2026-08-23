import { useMemo, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  getNoteProperties,
  listNoteTagTypes,
  type CollectionValue,
  type TagProperty,
} from '@reflect/core'
import { readCellValue } from '@/components/all-notes/collection-cell'
import { Check } from '@/components/icons'
import { PropertyValueEditor } from '@/components/tags/property-editors'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useCommitNoteProperty } from '@/lib/tags/use-commit-note-property'
import { cn } from '@/lib/utils'
import { useGraph } from '@/providers/graph-provider'
import { SidebarSection } from './sidebar-section'

interface NotePropertiesSectionProps {
  /** Graph-relative path of the note the sidebar describes. */
  path: string
}

/**
 * The note's typed properties (TDR 0005): the union of its tags' schemas,
 * each field editable in place through the shared property editors. Hidden
 * entirely while the note carries no typed tag — like the outline, an empty
 * panel would be furniture.
 */
export function NotePropertiesSection({ path }: NotePropertiesSectionProps): ReactElement | null {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const enabled = bridgeReady && graph !== null
  const commitProperty = useCommitNoteProperty()

  const { data: tagTypes } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'note-tag-types', path],
    queryFn: () => listNoteTagTypes(path),
    enabled,
  })
  const { data: values } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'note-properties', path],
    queryFn: () => getNoteProperties(path),
    enabled,
  })

  // The union of the note's tag schemas: tag-key order, then property order;
  // a key two tags declare renders once (the first declaration wins).
  const properties = useMemo(() => {
    const union: TagProperty[] = []
    const claimed = new Set<string>()
    for (const entry of tagTypes ?? []) {
      for (const property of entry.type.properties) {
        if (!claimed.has(property.key)) {
          claimed.add(property.key)
          union.push(property)
        }
      }
    }
    return union
  }, [tagTypes])

  if (properties.length === 0) {
    return null
  }

  return (
    <SidebarSection storageKey="note-properties" title="Properties">
      <ul className="space-y-0.5">
        {properties.map((property) => (
          <li key={property.key} className="flex min-h-7 items-center gap-2">
            <span className="w-24 shrink-0 truncate text-[13px] text-text-muted">
              {property.name}
            </span>
            <PropertyValueEditor
              property={property}
              value={values?.[property.key]}
              onCommit={(value) => commitProperty(path, property.key, value)}
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

/** The field's read-only face inside its editor trigger. */
function PropertyFieldValue({
  property,
  value,
}: {
  property: TagProperty
  value: CollectionValue | undefined
}): ReactElement {
  const reading = readCellValue(property, value)
  if (property.type === 'checkbox' && !reading.mismatch) {
    return reading.checked ? (
      <Check aria-hidden className="size-3.5 text-text-secondary" />
    ) : (
      <span aria-hidden className="size-3.5 rounded-sm border border-border" />
    )
  }
  return (
    <span
      className={cn(
        'min-w-0 flex-1 truncate rounded px-1 py-0.5 text-[13px] transition-colors hover:bg-surface-hover',
        reading.mismatch
          ? 'text-amber-700 dark:text-amber-300'
          : reading.text === ''
            ? 'text-text-muted'
            : 'text-text-secondary',
      )}
    >
      {reading.text === '' ? 'Empty' : reading.text}
    </span>
  )
}
