import { useMemo, useState, type DragEvent, type ReactElement } from 'react'
import { Virtualizer } from 'virtua'
import type { CollectionEntry, CollectionValue, TagProperty, TagType } from '@reflect/core'
import { Plus } from '@/components/icons'
import { PropertyValueEditor } from '@/components/tags/property-editors'
import { selectOptionDotClass } from '@/components/tags/select-colors'
import { useOpenTaskCounts } from '@/hooks/use-open-task-counts'
import { useOptimisticMoves } from '@/hooks/use-optimistic-moves'
import type { ModClickEvent } from '@/lib/windows/open-in-new-window'
import { boardGroupablePropertiesOf } from '@/lib/tags/schema-views'
import { useCommitNoteProperties } from '@/lib/tags/use-commit-note-property'
import { useCreateCollectionNote } from '@/lib/tags/use-create-collection-note'
import { cn } from '@/lib/utils'
import { editorSeedList } from '@/components/tags/property-editor-shared'
import { readCellValue } from './collection-cell'
import { CollectionTaskBadge } from './collection-task-badge'

/**
 * The Collection's kanban board (TDR 0005): the same rows as the table,
 * grouped into lanes by a groupable property — a `select` (one lane per
 * option), a `checkbox` (checked / not), or a `relation` (one lane per
 * target in use). Cards move by native drag: onto a lane to change its
 * value, onto a card to also take that position (a fractional `order`
 * frontmatter rank — midpoints between neighbours, so one drop writes one
 * note). An optimistic overlay moves the card instantly; the write lands
 * through the shared property commit and the index refresh reconciles. The
 * select editor stays as the keyboard path, and each lane's list is
 * virtualized so a thousand-card lane stays light.
 */

/** The frontmatter key manual board ranks live under — an ordinary shared
 * property (visible, portable), ascending, missing ranks sort last. */
export const BOARD_ORDER_KEY = 'order'

/** Every property the board can group by, schema order. */
export function groupableProperties(type: TagType): TagProperty[] {
  return boardGroupablePropertiesOf(type.properties)
}

/** The board's default grouping property: the schema's first groupable. */
export function boardProperty(type: TagType): TagProperty | null {
  return groupableProperties(type)[0] ?? null
}

export interface BoardColumn {
  /** Column title (an option, a live value, checked/not, or "No <name>"). */
  label: string
  /** The frontmatter value a drop into this lane writes (`null` clears). */
  commit: unknown
  /** The lane dot's color class, `null` for the neutral unset lane. */
  color: string | null
  entries: CollectionEntry[]
}

/** A stored manual rank, or `null` when the note has none. */
function rankOf(entry: CollectionEntry): number | null {
  const value = entry.properties[BOARD_ORDER_KEY]
  return value?.valueType === 'number' ? value.valueNumber : null
}

/** Ranked cards first (ascending), unranked keep their incoming order. */
function sortByRank(entries: CollectionEntry[]): CollectionEntry[] {
  return [...entries].sort((a, b) => {
    const rankA = rankOf(a)
    const rankB = rankOf(b)
    if (rankA === null && rankB === null) {
      return 0
    }
    if (rankA === null) {
      return 1
    }
    if (rankB === null) {
      return -1
    }
    return rankA - rankB
  })
}

/**
 * The rank a card inserted at `index` (into the lane's list *without* the
 * dragged card) should carry: the midpoint between ranked neighbours, one
 * past an edge, or `null` when no neighbour carries a rank a position could
 * be expressed against (the drop still changes the lane, never the order).
 */
export function rankForInsertion(
  entries: readonly CollectionEntry[],
  index: number,
): number | null {
  const before = index > 0 ? rankOf(entries[index - 1] as CollectionEntry) : null
  const after = index < entries.length ? rankOf(entries[index] as CollectionEntry) : null
  if (before !== null && after !== null) {
    return (before + after) / 2
  }
  if (before !== null) {
    return before + 1
  }
  if (after !== null) {
    return after - 1
  }
  // A wholly unranked lane: only "make it first" is expressible (rank 0
  // sorts ahead of every unranked card).
  return index === 0 && entries.length > 0 ? 0 : null
}

/**
 * Group entries into lanes by `property`. Select lanes follow the declared
 * options (empty ones included — a lane you can move cards into), stray
 * stored values get trailing lanes; checkbox boards are checked / everything
 * else; relation boards get one lane per target in use, alphabetical.
 * Valueless (or mismatched) rows land in the last, "No <name>" lane, and
 * every lane sorts its cards by the manual rank.
 */
export function boardColumns(
  entries: readonly CollectionEntry[],
  property: TagProperty,
): BoardColumn[] {
  const unset: CollectionEntry[] = []
  const columns: BoardColumn[] = []

  if (property.type === 'checkbox') {
    const checked: CollectionEntry[] = []
    for (const entry of entries) {
      const reading = readCellValue(property, entry.properties[property.key])
      if (!reading.mismatch && reading.checked) {
        checked.push(entry)
      } else {
        unset.push(entry)
      }
    }
    return [
      {
        label: `${property.name} ✓`,
        commit: true,
        color: selectOptionDotClass(property.name),
        entries: sortByRank(checked),
      },
      { label: `No ${property.name}`, commit: false, color: null, entries: sortByRank(unset) },
    ]
  }

  if (property.type === 'multiselect') {
    // One lane per option, and a card in *every* lane its list carries —
    // Notion's multi-select board. The unset lane keeps rows with an empty
    // (or missing) list; a drop's write is computed per card, since a lane
    // value alone cannot express add-this-remove-that on a list.
    const optionGroups = new Map<string, CollectionEntry[]>()
    for (const option of property.options ?? []) {
      optionGroups.set(option, [])
    }
    for (const entry of entries) {
      const values = editorSeedList(entry.properties[property.key])
      if (values.length === 0) {
        unset.push(entry)
        continue
      }
      for (const option of values) {
        const bucket = optionGroups.get(option)
        if (bucket === undefined) {
          optionGroups.set(option, [entry])
        } else {
          bucket.push(entry)
        }
      }
    }
    for (const [label, group] of optionGroups) {
      columns.push({
        label,
        commit: label,
        color: selectOptionDotClass(label),
        entries: sortByRank(group),
      })
    }
    columns.push({
      label: `No ${property.name}`,
      commit: null,
      color: null,
      entries: sortByRank(unset),
    })
    return columns
  }

  // select / relation: lanes keyed by the display text.
  const groups = new Map<string, { commit: unknown; entries: CollectionEntry[] }>()
  if (property.type === 'select' || property.type === 'status') {
    for (const option of property.options ?? []) {
      groups.set(option, { commit: option, entries: [] })
    }
  }
  for (const entry of entries) {
    const value = entry.properties[property.key]
    const reading = readCellValue(property, value)
    if (reading.mismatch || reading.text === '') {
      unset.push(entry)
      continue
    }
    const group = groups.get(reading.text)
    if (group === undefined) {
      // A stray select value, or a relation target: the lane commits the
      // stored raw form so aliases and link shapes survive a drop verbatim.
      groups.set(reading.text, {
        commit:
          property.type === 'select' || property.type === 'status'
            ? reading.text
            : (value?.value ?? reading.text),
        entries: [entry],
      })
    } else {
      group.entries.push(entry)
    }
  }
  const lanes = [...groups]
  if (property.type === 'relation' || property.type === 'person') {
    lanes.sort(([a], [b]) => a.localeCompare(b))
  }
  for (const [label, group] of lanes) {
    columns.push({
      label,
      commit: group.commit,
      color: selectOptionDotClass(label),
      entries: sortByRank(group.entries),
    })
  }
  columns.push({
    label: `No ${property.name}`,
    commit: null,
    color: null,
    entries: sortByRank(unset),
  })
  return columns
}

/**
 * The table's row groups (Plan 29 V1b): the board's lanes — same labels,
 * same declared-options order, same trailing "No <name>" — with two
 * table-shaped differences. Rows keep the incoming (sorted) order instead
 * of the board's manual rank, and a lane nothing lives in disappears: a
 * table renders no empty shelf to drop onto.
 */
export function tableGroupRows(
  entries: readonly CollectionEntry[],
  property: TagProperty,
): BoardColumn[] {
  const order = new Map(entries.map((entry, index) => [entry.path, index]))
  return boardColumns(entries, property)
    .map((column) => ({
      ...column,
      entries: [...column.entries].sort(
        (a, b) => (order.get(a.path) ?? 0) - (order.get(b.path) ?? 0),
      ),
    }))
    .filter((column) => column.entries.length > 0)
}

/** One optimistic move: the lane value plus the positional rank, if any. */
interface BoardMove {
  group: unknown
  rank: number | null
}

/** A committed value as the stored row the overlay projects it to. */
function overlayValue(value: unknown): CollectionValue | null {
  if (Array.isArray(value)) {
    // The projection's own list shape (JSON array text), so the optimistic
    // card reads exactly like the re-indexed row will.
    return { value: JSON.stringify(value), valueType: 'list', valueNumber: value.length }
  }
  if (typeof value === 'boolean') {
    return { value: String(value), valueType: 'boolean', valueNumber: null }
  }
  if (typeof value === 'number') {
    return { value: String(value), valueType: 'number', valueNumber: value }
  }
  if (typeof value === 'string') {
    return { value, valueType: 'string', valueNumber: null }
  }
  return null
}

interface CollectionBoardProps {
  entries: readonly CollectionEntry[] | undefined
  /** The routed tag — a lane's "+" creates a note that is born in it. */
  tag: string
  /** The tag's type, so a new row can seed from a bound template. */
  type: TagType
  /** The grouping property — the screen only renders the board when
   * {@link boardProperty} found one, so it arrives resolved. */
  property: TagProperty
  onOpen: (path: string, event?: ModClickEvent) => void
}

export function CollectionBoard({
  entries,
  tag,
  type,
  property,
  onOpen,
}: CollectionBoardProps): ReactElement {
  const commitProperties = useCommitNoteProperties()
  const createNote = useCreateCollectionNote(tag, type)
  const { moves, record } = useOptimisticMoves<BoardMove>(entries)
  // The cards' open-task badges (the project pulse) — one batched read.
  const entryPaths = useMemo(() => (entries ?? []).map((entry) => entry.path), [entries])
  const taskCounts = useOpenTaskCounts(entryPaths)
  // The dragged card's path lives in React state, not only in the
  // DataTransfer: `dragover` cannot read the payload (spec), and gating the
  // handlers on it keeps foreign drags (files onto the window) refused.
  const [draggingPath, setDraggingPath] = useState<string | null>(null)
  // The lane the drag started from — a multiselect move must know which
  // option to remove, since the card may live in several lanes at once.
  const [draggingFrom, setDraggingFrom] = useState<string | null>(null)
  const [dropLane, setDropLane] = useState<string | null>(null)

  const effectiveEntries = useMemo(
    () =>
      (entries ?? []).map((entry) => {
        const move = moves.get(entry.path)
        if (move === undefined) {
          return entry
        }
        const properties = { ...entry.properties }
        const grouped = overlayValue(move.group)
        if (grouped === null) {
          delete properties[property.key]
        } else {
          properties[property.key] = grouped
        }
        if (move.rank !== null) {
          properties[BOARD_ORDER_KEY] = {
            value: String(move.rank),
            valueType: 'number',
            valueNumber: move.rank,
          }
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
    setDraggingFrom(null)
    setDropLane(null)
  }

  /** Land a drop: onto a lane (append) or before `targetPath`'s card. */
  const drop = (column: BoardColumn, targetPath: string | null): void => {
    const path = draggingPath
    const from = draggingFrom
    endDrag()
    if (path === null || path === targetPath) {
      return
    }
    const sameLane = column.entries.some((entry) => entry.path === path)
    const others = column.entries.filter((entry) => entry.path !== path)
    const index =
      targetPath === null ? others.length : others.findIndex((entry) => entry.path === targetPath)
    const rank = index < 0 ? null : rankForInsertion(others, index)
    if (property.type === 'multiselect') {
      // Move between lanes = drop the source option, gain the target's; onto
      // the unset lane = drop the source option only (the card honestly
      // stays in any *other* lane it carries).
      if (from === column.label && rank === null) {
        return
      }
      const current = editorSeedList(
        effectiveEntries.find((entry) => entry.path === path)?.properties[property.key],
      )
      const target = typeof column.commit === 'string' ? column.commit : null
      const next = current.filter((value) => value !== from && value !== target)
      if (target !== null) {
        next.push(target)
      }
      record(path, { group: next.length > 0 ? next : null, rank })
      commitProperties(path, {
        [property.key]: next.length > 0 ? next : undefined,
        ...(rank !== null ? { [BOARD_ORDER_KEY]: rank } : {}),
      })
      return
    }
    if (sameLane && rank === null) {
      return
    }
    record(path, { group: column.commit, rank })
    commitProperties(path, {
      [property.key]: column.commit ?? undefined,
      ...(rank !== null ? { [BOARD_ORDER_KEY]: rank } : {}),
    })
  }

  /** Create a note born in `column`: tagged, with the lane's value set. */
  const createInLane = async (column: BoardColumn): Promise<void> => {
    const laneValue =
      property.type === 'multiselect' && typeof column.commit === 'string'
        ? [column.commit]
        : column.commit
    const path = await createNote(laneValue === null ? {} : { [property.key]: laneValue })
    if (path !== null) {
      onOpen(path)
    }
  }

  return (
    <div className="flex h-full items-stretch gap-4 overflow-x-auto px-12 pb-6">
      {columns.map((column) => (
        <section
          key={column.label}
          aria-label={column.label}
          className={cn(
            'flex max-h-full w-60 flex-none flex-col rounded-xl bg-surface-hover/60 p-2',
            draggingPath !== null && dropLane === column.label && 'ring-2 ring-accent/60',
          )}
          onDragOver={(event) => {
            if (draggingPath !== null) {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
              setDropLane(column.label)
            }
          }}
          onDragLeave={(event: DragEvent<HTMLElement>) => {
            // Child elements fire enter/leave pairs; only leaving the lane
            // itself clears the highlight.
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setDropLane((current) => (current === column.label ? null : current))
            }
          }}
          onDrop={(event) => {
            event.preventDefault()
            drop(column, null)
          }}
        >
          <header className="flex flex-none items-center gap-1.5 px-2 py-1.5">
            {column.color !== null ? (
              <span aria-hidden className={cn('size-2 shrink-0 rounded-full', column.color)} />
            ) : null}
            <h2 className="min-w-0 flex-1 truncate text-xs font-medium text-text-secondary">
              {column.label}
            </h2>
            <span className="text-xs tabular-nums text-text-muted">{column.entries.length}</span>
            <button
              type="button"
              aria-label={`New note in ${column.label}`}
              onClick={() => void createInLane(column)}
              className="flex size-4 items-center justify-center rounded text-text-muted hover:text-text-secondary"
            >
              <Plus aria-hidden className="size-3" />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Virtualizer data={column.entries} itemSize={64} bufferSize={400}>
              {(entry) => (
                <div className="pb-1.5">
                  <article
                    data-note-path={entry.path}
                    draggable
                    onDragStart={(event) => {
                      setDraggingPath(entry.path)
                      setDraggingFrom(column.label)
                      event.dataTransfer.setData('text/plain', entry.path)
                      event.dataTransfer.effectAllowed = 'move'
                    }}
                    onDragEnd={endDrag}
                    onDragOver={(event) => {
                      if (draggingPath !== null) {
                        event.preventDefault()
                        event.stopPropagation()
                        event.dataTransfer.dropEffect = 'move'
                        setDropLane(column.label)
                      }
                    }}
                    onDrop={(event) => {
                      // A drop on a card takes its position (before it); the
                      // lane handler must not double-handle the same drop.
                      event.preventDefault()
                      event.stopPropagation()
                      drop(column, entry.path)
                    }}
                    className={cn(
                      'flex cursor-grab flex-col gap-1 rounded-xl border border-border bg-surface p-2.5 shadow-sm active:cursor-grabbing',
                      draggingPath === entry.path && 'opacity-50',
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={(event) => onOpen(entry.path, event)}
                        className="min-w-0 flex-1 truncate text-left text-[13px] font-medium text-text hover:underline"
                      >
                        {entry.title}
                      </button>
                      {(taskCounts[entry.path] ?? 0) > 0 ? (
                        <CollectionTaskBadge count={taskCounts[entry.path] ?? 0} />
                      ) : null}
                    </div>
                    <PropertyValueEditor
                      property={property}
                      value={entry.properties[property.key]}
                      onCommit={(value) => commitProperties(entry.path, { [property.key]: value })}
                    >
                      <span className="truncate text-xs text-text-muted">
                        {boardCardValueText(property, entry)}
                      </span>
                    </PropertyValueEditor>
                  </article>
                </div>
              )}
            </Virtualizer>
          </div>
        </section>
      ))}
    </div>
  )
}

/** The card's secondary line: the grouped value (checkboxes as a glyph). */
function boardCardValueText(property: TagProperty, entry: CollectionEntry): string {
  const reading = readCellValue(property, entry.properties[property.key])
  if (property.type === 'checkbox' && !reading.mismatch) {
    return reading.checked ? '✓' : '—'
  }
  return reading.text || '—'
}
