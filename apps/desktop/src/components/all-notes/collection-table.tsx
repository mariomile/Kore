import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { Virtualizer, type VirtualizerHandle } from 'virtua'
import {
  DENSITY_ROW_HEIGHT,
  TITLE_SORT_KEY,
  UPDATED_SORT_KEY,
  type CollectionEntry,
  type CollectionSort,
  type TagProperty,
  type TagPropertyType,
  type TagType,
} from '@reflect/core'
import { ArrowDown, ArrowUp, Plus } from '@/components/icons'
import { PropertyValueEditor } from '@/components/tags/property-editors'
import type { ListSelection } from '@/lib/selection/use-list-selection'
import { useCommitNoteProperty } from '@/lib/tags/use-commit-note-property'
import { useOpenRelation } from '@/lib/tags/use-open-relation'
import { cn } from '@/lib/utils'
import { useSettings } from '@/providers/settings-provider'
import type { ModClickEvent } from '@/lib/windows/open-in-new-window'
import { useOpenTaskCounts } from '@/hooks/use-open-task-counts'
import { AddPropertyPopover } from './add-property-popover'
import { CollectionCell } from './collection-cell'
import { ColumnHeaderMenu } from './column-header-menu'
import { collectionGridStyle, COLLECTION_GRID_CLASS } from './collection-grid'
import { CollectionRow } from './collection-row'
import { TABLE_HEADER_CHROME } from './table-chrome'
import type { BoardColumn } from './collection-board'

interface CollectionTableProps {
  /** `undefined` while the collection query settles. */
  entries: CollectionEntry[] | undefined
  tag: string
  /** The tag's schema, hidden columns already filtered out. */
  type: TagType
  selection: ListSelection
  /** The sort chain; the second key breaks the first's ties. Empty = recall order. */
  sorts: readonly CollectionSort[]
  onSortChange: (sorts: readonly CollectionSort[]) => void
  /** Manual column widths (rem, per property key) — a header-edge drag. */
  columnWidths: Record<string, number>
  onColumnWidthChange: (key: string, rem: number) => void
  /** Open the tag's schema dialog (options, targets, rollups, formulas). */
  onEditSchema: () => void
  /** Append a property from the header's "+" (name and type, nothing else). */
  onAddProperty: (name: string, type: TagPropertyType) => Promise<void>
  /** Drop a property from a column's menu. */
  onDeleteProperty: (key: string) => Promise<void>
  /** Hide a column from its menu; absent where columns cannot hide. */
  onHideColumn?: ((key: string) => void) | undefined
  /** Birth a row titled `title` from the table's last line. */
  onCreateRow: (title: string) => Promise<void>
  /**
   * Row groups (Plan 29 V1b), already computed over `entries` by the screen
   * so its selection order and these shelves can never disagree. `null` =
   * the flat table.
   */
  groups: readonly BoardColumn[] | null
  onOpen: (path: string, event?: ModClickEvent) => void
  registerScrollToIndex: (scrollToIndex: (index: number) => void) => void
}

/** One virtualized line: a group's shelf header, or a note's row. */
type TableItem =
  | { kind: 'group'; label: string; color: string | null; count: number }
  | { kind: 'row'; entry: CollectionEntry }

/**
 * The Collection table (TDR 0005): the All Notes table's shape — sticky
 * header over virtualized fixed-height rows — with typed columns from the
 * tag's schema. Every header sorts (asc → desc → off; Subject and Updated
 * ride the `$title`/`$updated` sentinels); property columns resize by
 * dragging the header's right edge; a footer aggregates what the eye can't
 * (count filled, sum for numbers).
 */
export function CollectionTable({
  entries,
  tag,
  type,
  selection,
  sorts,
  onSortChange,
  columnWidths,
  onColumnWidthChange,
  onEditSchema,
  onAddProperty,
  onDeleteProperty,
  onHideColumn,
  onCreateRow,
  groups,
  onOpen,
  registerScrollToIndex,
}: CollectionTableProps): ReactElement | null {
  const density = useSettings().settings.uiDensity
  const rowHeight = DENSITY_ROW_HEIGHT[density] ?? DENSITY_ROW_HEIGHT.default
  const { clickSelect, isSelected } = selection
  const virtualizerRef = useRef<VirtualizerHandle>(null)
  // During a drag the draft widths render live; the persisted setting only
  // takes over once the pointer lifts (one settings write per resize).
  const [draftWidths, setDraftWidths] = useState<Record<string, number> | null>(null)
  const effectiveWidths = draftWidths ?? columnWidths
  const gridStyle = useMemo(
    () => collectionGridStyle(type, effectiveWidths),
    [type, effectiveWidths],
  )
  const commitProperty = useCommitNoteProperty()
  const openRelation = useOpenRelation()
  // The "+ New" line: a title typed in place becomes a row (the note is born
  // on Enter, never on focus, so an abandoned line leaves no file behind).
  const [draftTitle, setDraftTitle] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const commitDraft = async (): Promise<void> => {
    const title = (draftTitle ?? '').trim()
    if (title === '' || creating) {
      setDraftTitle(null)
      return
    }
    setCreating(true)
    try {
      await onCreateRow(title)
      setDraftTitle(null)
    } finally {
      setCreating(false)
    }
  }
  const onDraftKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void commitDraft()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setDraftTitle(null)
    }
  }
  // The footer sums are O(rows × columns): memoized so a selection click or
  // a resize drag's per-pointermove re-render reuses them.
  const aggregates = useMemo(
    () => type.properties.map((property) => columnAggregate(property, entries ?? [])),
    [type.properties, entries],
  )
  // The rows' open-task badges (the project pulse) — one batched read.
  const entryPaths = useMemo(() => (entries ?? []).map((entry) => entry.path), [entries])
  const taskCounts = useOpenTaskCounts(entryPaths)
  // Grouped, the virtualizer renders shelf headers between the rows; the
  // index map turns the selection's flat row index back into an item index
  // so keyboard navigation still pulls off-screen rows into view.
  const { items, rowItemIndex } = useMemo(() => {
    if (groups === null) {
      return {
        items: (entries ?? []).map((entry): TableItem => ({ kind: 'row', entry })),
        rowItemIndex: null,
      }
    }
    const list: TableItem[] = []
    const indexes: number[] = []
    for (const group of groups) {
      list.push({
        kind: 'group',
        label: group.label,
        color: group.color,
        count: group.entries.length,
      })
      for (const entry of group.entries) {
        indexes.push(list.length)
        list.push({ kind: 'row', entry })
      }
    }
    return { items: list, rowItemIndex: indexes }
  }, [entries, groups])

  const handleToggle = useCallback(
    (path: string, event: Pick<MouseEvent, 'shiftKey'>) =>
      clickSelect(
        path,
        event.shiftKey
          ? { metaKey: false, ctrlKey: false, shiftKey: true }
          : { metaKey: true, ctrlKey: false, shiftKey: false },
      ),
    [clickSelect],
  )

  useEffect(() => {
    registerScrollToIndex((index) => {
      const itemIndex = rowItemIndex === null ? index : (rowItemIndex[index] ?? -1)
      if (itemIndex >= 0) {
        virtualizerRef.current?.scrollToIndex(itemIndex, { align: 'nearest' })
      }
    })
  }, [registerScrollToIndex, rowItemIndex])

  // A header click owns the whole chain: asc → desc → off on this key alone.
  const primary = sorts[0] ?? null
  const cycleSort = (key: string): void => {
    if (primary === null || primary.key !== key || sorts.length > 1) {
      onSortChange([{ key, direction: 'asc' }])
    } else if (primary.direction === 'asc') {
      onSortChange([{ key, direction: 'desc' }])
    } else {
      onSortChange([])
    }
  }
  /** A column menu's sort: the head of a new chain, or the next link of this one. */
  const sortBy = (key: string, direction: 'asc' | 'desc', then: boolean): void => {
    onSortChange(
      then
        ? [...sorts.filter((sort) => sort.key !== key), { key, direction }]
        : [{ key, direction }],
    )
  }

  const startResize = (key: string) => (event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const handle = event.currentTarget
    const cell = handle.parentElement
    if (cell === null) {
      return
    }
    const startX = event.clientX
    const startRem = columnWidths[key] ?? cell.getBoundingClientRect().width / 16
    let lastRem = startRem
    handle.setPointerCapture(event.pointerId)
    const onMove = (moveEvent: PointerEvent): void => {
      lastRem = Math.max(3, Math.round((startRem + (moveEvent.clientX - startX) / 16) * 4) / 4)
      setDraftWidths({ ...columnWidths, [key]: lastRem })
    }
    const onUp = (): void => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      setDraftWidths(null)
      onColumnWidthChange(key, lastRem)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
  }

  const sortButton = (key: string, name: string, className?: string): ReactNode => {
    const position = sorts.findIndex((sort) => sort.key === key)
    const sort = position === -1 ? null : sorts[position]!
    const active = sort !== null
    // A plain button carries no columnheader role, so `aria-sort` wouldn't
    // apply — the sort state rides the accessible name; a link past the
    // chain's head says so.
    const sortState = !active
      ? ''
      : `${sort.direction === 'asc' ? ', sorted ascending' : ', sorted descending'}${
          position > 0 ? ` (then by, ${position + 1})` : ''
        }`
    return (
      <button
        type="button"
        onClick={() => cycleSort(key)}
        aria-label={`Sort by ${name}${sortState}`}
        className={cn(
          'flex min-w-0 items-center gap-1 truncate text-left font-medium transition-colors hover:text-text',
          active ? 'text-text' : 'text-text-secondary',
          className,
        )}
      >
        <span className="truncate">{name}</span>
        {active ? (
          sort.direction === 'asc' ? (
            <ArrowUp aria-hidden className="size-3 shrink-0" />
          ) : (
            <ArrowDown aria-hidden className="size-3 shrink-0" />
          )
        ) : null}
        {position > 0 ? (
          <span aria-hidden className="text-2xs tabular-nums text-text-muted">
            {position + 1}
          </span>
        ) : null}
      </button>
    )
  }

  if (entries === undefined) {
    return null
  }
  // The last line of the table is always the next row.
  const newRow =
    draftTitle === null ? (
      <button
        type="button"
        aria-label="New row"
        onClick={() => setDraftTitle('')}
        style={{ minWidth: gridStyle.minWidth }}
        className="flex h-(--row-height) w-full items-center gap-1.5 pl-12 pr-7 text-[13px] text-text-muted transition-colors hover:bg-surface-hover hover:text-text-secondary"
      >
        <Plus aria-hidden className="size-3" />
        New
      </button>
    ) : (
      <div
        style={{ minWidth: gridStyle.minWidth }}
        className="flex h-(--row-height) items-center pl-12 pr-7"
      >
        <input
          autoFocus
          aria-label="New row title"
          placeholder="Title, then Enter"
          value={draftTitle}
          disabled={creating}
          onChange={(event) => setDraftTitle(event.target.value)}
          onKeyDown={onDraftKeyDown}
          onBlur={() => void commitDraft()}
          className="w-full bg-transparent text-[13px] font-medium text-text outline-none placeholder:text-text-muted"
        />
      </div>
    )
  return (
    <>
      <div style={gridStyle} className={cn(COLLECTION_GRID_CLASS, TABLE_HEADER_CHROME)}>
        {sortButton(TITLE_SORT_KEY, 'Title')}
        {type.properties.map((property) => (
          <span
            key={property.key}
            className="group/header relative flex min-w-0 items-center gap-1"
          >
            {sortButton(property.key, property.name)}
            <ColumnHeaderMenu
              property={property}
              onSort={(direction, then) => sortBy(property.key, direction, then)}
              sorted={sorts.length > 0}
              onHide={onHideColumn === undefined ? undefined : () => onHideColumn(property.key)}
              onEditSchema={onEditSchema}
              onDelete={() => onDeleteProperty(property.key)}
            />
            <span
              role="separator"
              aria-label={`Resize ${property.name}`}
              onPointerDown={startResize(property.key)}
              className="absolute -right-2.5 top-1/2 h-5 w-2 -translate-y-1/2 cursor-col-resize rounded hover:bg-border"
            />
          </span>
        ))}
        <span className="flex items-center justify-end gap-1.5">
          {sortButton(UPDATED_SORT_KEY, 'Updated', 'justify-end text-right')}
          <AddPropertyPopover onAdd={onAddProperty} onEditSchema={onEditSchema} />
        </span>
      </div>
      {entries.length === 0 ? (
        <>
          <p className="py-8 pl-12 pr-7 text-sm text-text-muted">No notes tagged #{tag}.</p>
          {newRow}
        </>
      ) : (
        <>
          <Virtualizer
            ref={virtualizerRef}
            as="ul"
            item="li"
            data={items}
            itemSize={rowHeight}
            bufferSize={10 * rowHeight}
          >
            {(item) =>
              item.kind === 'group' ? (
                <div
                  key={`group:${item.label}`}
                  role="heading"
                  aria-level={2}
                  // Width rides the grid template's own floor so the shelf
                  // scrolls in step with the rows under a horizontal scroll.
                  style={{ minWidth: gridStyle.minWidth }}
                  className="flex h-(--row-height) select-none items-end gap-2 pb-1.5 pl-12 pr-7"
                >
                  {item.color === null ? null : (
                    <span aria-hidden className={cn('mb-0.5 size-2 rounded-full', item.color)} />
                  )}
                  <span className="text-xs font-semibold leading-none text-text">{item.label}</span>
                  <span className="text-xs leading-none tabular-nums text-text-muted">
                    {item.count}
                  </span>
                </div>
              ) : (
                <CollectionRow
                  key={item.entry.path}
                  entry={item.entry}
                  gridStyle={gridStyle}
                  selected={isSelected(item.entry.path)}
                  openTasks={taskCounts[item.entry.path] ?? 0}
                  onSelect={clickSelect}
                  onToggle={handleToggle}
                  onOpen={onOpen}
                >
                  {type.properties.map((property) => (
                    <PropertyValueEditor
                      key={property.key}
                      property={property}
                      value={item.entry.properties[property.key]}
                      onCommit={(value) => commitProperty(item.entry.path, property.key, value)}
                      onOpenRelation={openRelation}
                    >
                      <CollectionCell
                        property={property}
                        value={item.entry.properties[property.key]}
                        selected={isSelected(item.entry.path)}
                      />
                    </PropertyValueEditor>
                  ))}
                </CollectionRow>
              )
            }
          </Virtualizer>
          {newRow}
          <div
            style={gridStyle}
            className={cn(
              COLLECTION_GRID_CLASS,
              'border-t border-border py-2 text-xs tabular-nums text-text-muted',
            )}
          >
            <span>{`${entries.length} ${entries.length === 1 ? 'note' : 'notes'}`}</span>
            {type.properties.map((property, index) => (
              <span key={property.key} className="truncate">
                {aggregates[index]}
              </span>
            ))}
            <span />
          </div>
        </>
      )}
    </>
  )
}

/**
 * The footer's read of one column: numbers sum (the spreadsheet instinct),
 * everything else counts filled cells; an untouched column stays blank.
 */
export function columnAggregate(
  property: TagProperty,
  entries: readonly CollectionEntry[],
): string {
  if (property.type === 'number' || property.type === 'rating') {
    let sum = 0
    let any = false
    for (const entry of entries) {
      const value = entry.properties[property.key]
      if (value?.valueType === 'number' && value.valueNumber !== null) {
        sum += value.valueNumber
        any = true
      }
    }
    return any ? `Σ ${Number.isSafeInteger(sum) ? sum : Math.round(sum * 100) / 100}` : ''
  }
  const filled = entries.reduce(
    (total, entry) => total + (entry.properties[property.key] === undefined ? 0 : 1),
    0,
  )
  return filled === 0 ? '' : `${filled} filled`
}
