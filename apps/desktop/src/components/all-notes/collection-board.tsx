import { useMemo, useState, type DragEvent, type ReactElement } from 'react'
import type { CollectionEntry, TagProperty, TagType } from '@reflect/core'
import { PropertyValueEditor } from '@/components/tags/property-editors'
import type { ModClickEvent } from '@/lib/windows/open-in-new-window'
import { useCommitNoteProperty } from '@/lib/tags/use-commit-note-property'
import { cn } from '@/lib/utils'
import { readCellValue } from './collection-cell'

/**
 * The Collection's kanban board (TDR 0005): the same rows as the table,
 * grouped into lanes by the tag's first `select` property. Cards move by
 * native drag onto a lane (an optimistic overlay moves the card instantly;
 * the write lands through the shared property commit and the index refresh
 * reconciles), and the same select editor the table uses stays as the
 * keyboard path.
 */

/** The property the board groups by: the schema's first `select`. */
export function boardProperty(type: TagType): TagProperty | null {
  return type.properties.find((property) => property.type === 'select') ?? null
}

interface BoardColumn {
  /** Column title (an option, a stray stored value, or "No <name>"). */
  label: string
  /** The frontmatter value a drop into this lane writes (`null` clears). */
  value: string | null
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
    ...[...groups].map(([label, grouped]) => ({ label, value: label, entries: grouped })),
    { label: `No ${property.name}`, value: null, entries: unset },
  ]
}

interface CollectionBoardProps {
  entries: readonly CollectionEntry[] | undefined
  /** The grouping select property — the screen only renders the board when
   * {@link boardProperty} found one, so it arrives resolved. */
  property: TagProperty
  onOpen: (path: string, event?: ModClickEvent) => void
}

export function CollectionBoard({ entries, property, onOpen }: CollectionBoardProps): ReactElement {
  const commitProperty = useCommitNoteProperty()
  // A drop moves the card at once through this overlay; the stored rows only
  // catch up after write → watcher → refetch, and a fresh `entries` prop
  // (which now carries the written value) clears it at render time.
  const [moves, setMoves] = useState<Map<string, string | null>>(new Map())
  const [movesFor, setMovesFor] = useState(entries)
  if (movesFor !== entries) {
    setMovesFor(entries)
    setMoves(new Map())
  }
  // The dragged card's path lives in React state, not only in the
  // DataTransfer: `dragover` cannot read the payload (spec), and gating the
  // handlers on it keeps foreign drags (files onto the window) refused.
  const [draggingPath, setDraggingPath] = useState<string | null>(null)
  const [dropLane, setDropLane] = useState<string | null>(null)

  const effectiveEntries = useMemo(
    () =>
      (entries ?? []).map((entry) => {
        const moved = moves.get(entry.path)
        if (moved === undefined) {
          return entry
        }
        const properties = { ...entry.properties }
        if (moved === null) {
          delete properties[property.key]
        } else {
          properties[property.key] = { value: moved, valueType: 'string', valueNumber: null }
        }
        return { ...entry, properties }
      }),
    [entries, moves, property.key],
  )
  const columns = useMemo(
    () => boardColumns(effectiveEntries, property),
    [effectiveEntries, property],
  )

  const endDrag = (): void => {
    setDraggingPath(null)
    setDropLane(null)
  }
  const dropOnLane = (column: BoardColumn, event: DragEvent<HTMLElement>): void => {
    event.preventDefault()
    const path = draggingPath
    endDrag()
    // A drop into the card's own lane is a no-op, not a phantom write.
    if (path === null || column.entries.some((entry) => entry.path === path)) {
      return
    }
    setMoves((current) => new Map(current).set(path, column.value))
    commitProperty(path, property.key, column.value ?? undefined)
  }

  return (
    <div className="flex h-full items-start gap-4 overflow-x-auto px-12 pb-6">
      {columns.map((column) => (
        <section
          key={column.label}
          aria-label={column.label}
          className={cn(
            'flex w-60 flex-none flex-col rounded-lg bg-surface-hover/60 p-2',
            draggingPath !== null && dropLane === column.label && 'ring-2 ring-accent/60',
          )}
          onDragOver={(event) => {
            if (draggingPath !== null) {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
              setDropLane(column.label)
            }
          }}
          onDragLeave={(event) => {
            // Child elements fire enter/leave pairs; only leaving the lane
            // itself clears the highlight.
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setDropLane((current) => (current === column.label ? null : current))
            }
          }}
          onDrop={(event) => dropOnLane(column, event)}
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
                draggable
                onDragStart={(event) => {
                  setDraggingPath(entry.path)
                  event.dataTransfer.setData('text/plain', entry.path)
                  event.dataTransfer.effectAllowed = 'move'
                }}
                onDragEnd={endDrag}
                className={cn(
                  'flex cursor-grab flex-col gap-1 rounded-md border border-border bg-surface p-2 shadow-sm active:cursor-grabbing',
                  draggingPath === entry.path && 'opacity-50',
                )}
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
