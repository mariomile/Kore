import { useMemo, type ReactElement } from 'react'
import type { CollectionEntry, TagProperty, TagType } from '@reflect/core'
import { PropertyValueEditor } from '@/components/tags/property-editors'
import type { ModClickEvent } from '@/lib/windows/open-in-new-window'
import { useCommitNoteProperty } from '@/lib/tags/use-commit-note-property'
import { readCellValue } from './collection-cell'

/**
 * The Collection's board view (TDR 0005): the same rows as the table,
 * grouped into columns by the tag's first `select` property. No dragging in
 * V1 — a card's status changes through the same select editor the table
 * uses, which reads as a click-to-move that also works with a keyboard.
 */

/** The property the board groups by: the schema's first `select`. */
export function boardProperty(type: TagType): TagProperty | null {
  return type.properties.find((property) => property.type === 'select') ?? null
}

interface BoardColumn {
  /** Column title (an option, a stray stored value, or "No <name>"). */
  label: string
  entries: CollectionEntry[]
}

/** Group entries by the select property's display value. Declared options
 * keep their configured order (empty ones included — a lane you can move
 * cards into); stray stored values get their own trailing columns rather
 * than vanishing; valueless rows land in the last, "No <name>" column. */
export function boardColumns(
  entries: readonly CollectionEntry[],
  property: TagProperty,
): BoardColumn[] {
  const options = property.options ?? []
  const groups = new Map<string, CollectionEntry[]>(options.map((option) => [option, []]))
  const unset: CollectionEntry[] = []
  for (const entry of entries) {
    const reading = readCellValue(property, entry.properties[property.key])
    if (reading.mismatch || reading.text === '') {
      unset.push(entry)
      continue
    }
    const group = groups.get(reading.text)
    if (group === undefined) {
      groups.set(reading.text, [entry])
    } else {
      group.push(entry)
    }
  }
  return [
    ...[...groups].map(([label, grouped]) => ({ label, entries: grouped })),
    { label: `No ${property.name}`, entries: unset },
  ]
}

interface CollectionBoardProps {
  entries: readonly CollectionEntry[] | undefined
  type: TagType
  onOpen: (path: string, event?: ModClickEvent) => void
}

export function CollectionBoard({
  entries,
  type,
  onOpen,
}: CollectionBoardProps): ReactElement | null {
  const commitProperty = useCommitNoteProperty()
  const property = boardProperty(type)
  const columns = useMemo(
    () => (property === null ? [] : boardColumns(entries ?? [], property)),
    [entries, property],
  )
  if (property === null) {
    return null
  }

  return (
    <div className="flex h-full items-start gap-4 overflow-x-auto px-12 pb-6">
      {columns.map((column) => (
        <section
          key={column.label}
          aria-label={column.label}
          className="flex w-60 flex-none flex-col rounded-lg bg-surface-hover/60 p-2"
        >
          <header className="flex items-center justify-between px-2 py-1.5">
            <h2 className="truncate text-xs font-medium text-text-secondary">{column.label}</h2>
            <span className="text-xs tabular-nums text-text-muted">{column.entries.length}</span>
          </header>
          <div className="flex flex-col gap-1.5">
            {column.entries.map((entry) => (
              <article
                key={entry.path}
                data-note-path={entry.path}
                className="flex flex-col gap-1 rounded-md border border-border bg-surface p-2 shadow-sm"
              >
                <button
                  type="button"
                  onClick={(event) => onOpen(entry.path, event)}
                  className="truncate text-left text-[13px] font-medium text-text hover:underline"
                >
                  {entry.title}
                </button>
                <PropertyValueEditor
                  property={property}
                  value={entry.properties[property.key]}
                  onCommit={(value) => commitProperty(entry.path, property.key, value)}
                >
                  <span className="truncate text-xs text-text-muted">
                    {readCellValue(property, entry.properties[property.key]).text || '—'}
                  </span>
                </PropertyValueEditor>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
