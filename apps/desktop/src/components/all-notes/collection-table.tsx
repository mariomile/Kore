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
  TITLE_SORT_KEY,
  UPDATED_SORT_KEY,
  type CollectionEntry,
  type CollectionSort,
  type TagProperty,
  type TagPropertyType,
  type TagType,
} from '@kore/core'
import { ArrowDown, ArrowUp, History, Note, Plus } from '@/components/icons'
import { PropertyValueEditor } from '@/components/tags/property-editors'
import { PROPERTY_TYPE_ICONS } from '@/components/tags/property-type-icons'
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
import {
  COLLECTION_GRID_CLASS,
  COLLECTION_ROW_HEIGHT,
  collectionGridStyle,
  defaultColumnRem,
  defaultTitleRem,
  titleGutterRem,
} from './collection-grid'
import { CollectionRow } from './collection-row'
import type { BoardColumn } from './collection-board'
import './collection-table.css'

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
  /** Manual column widths (rem, per property key or `$title`) — a header-edge drag. */
  columnWidths: Record<string, number>
  onColumnWidthChange: (key: string, rem: number) => void
  /** Open the tag's schema dialog (options, targets, rollups, formulas). */
  onEditSchema?: (() => void) | undefined
  /** Append a property from the header's "+" (name and type, nothing else). */
  onAddProperty?: ((name: string, type: TagPropertyType) => Promise<void>) | undefined
  /** Drop a property from a column's menu. */
  onDeleteProperty?: ((key: string) => Promise<void>) | undefined
  /** Hide a column from its menu; absent where columns cannot hide. */
  onHideColumn?: ((key: string) => void) | undefined
  /** Keys whose cells may edit. Absent keeps every property editable. */
  editableKeys?: ReadonlySet<string> | undefined
  /** Conflicting fields whose stored representation must remain visible raw. */
  rawKeys?: ReadonlySet<string> | undefined
  /** Birth a row titled `title` from the table's last line. */
  onCreateRow: (title: string) => Promise<void>
  /**
   * Row groups (Plan 29 V1b), already computed over `entries` by the screen
   * so its selection order and these shelves can never disagree. `null` =
   * the flat table.
   */
  groups: readonly BoardColumn[] | null
  /** Compact left gutter for tables embedded inside a note card. */
  embedded?: boolean
  onOpen: (path: string, event?: ModClickEvent) => void
  registerScrollToIndex: (scrollToIndex: (index: number) => void) => void
}

/** One virtualized line: a group's shelf header, or a note's row. */
type TableItem =
  | { kind: 'group'; label: string; color: string | null; count: number }
  | { kind: 'row'; entry: CollectionEntry }

const INLINE_INPUT_TYPES: ReadonlySet<TagPropertyType> = new Set([
  'text',
  'number',
  'date',
  'url',
  'email',
  'phone',
  'rating',
  'files',
])

const READ_ONLY_PROPERTY_TYPES: ReadonlySet<TagPropertyType> = new Set([
  'rollup',
  'reverse',
  'formula',
  'created',
  'updated',
])

/**
 * The Collection table (TDR 0005): a Notion-style database grid with a sticky
 * resizable Title column, typed column icons, crisp cell borders, inline cell
 * editing with Tab stepping, column resize handles (double-click to reset),
 * dedicated "+" property column, and a pinned aggregate footer.
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
  editableKeys,
  rawKeys,
  onCreateRow,
  groups,
  embedded = false,
  onOpen,
  registerScrollToIndex,
}: CollectionTableProps): ReactElement | null {
  const density = useSettings().settings.uiDensity
  const rowHeight = COLLECTION_ROW_HEIGHT[density] ?? COLLECTION_ROW_HEIGHT.default
  const { clickSelect, isSelected } = selection
  const virtualizerRef = useRef<VirtualizerHandle>(null)
  const headerRef = useRef<HTMLDivElement | null>(null)
  const lastResizeClickRef = useRef<{ key: string; at: number } | null>(null)
  // During a drag the draft widths render live; the persisted setting only
  // takes over once the pointer lifts (one settings write per resize).
  const [draftWidths, setDraftWidths] = useState<Record<string, number> | null>(null)
  const [resizingKey, setResizingKey] = useState<string | null>(null)
  const effectiveWidths = draftWidths ?? columnWidths
  const showAddColumn = onAddProperty !== undefined && onEditSchema !== undefined
  const gridStyle = useMemo(
    () => collectionGridStyle(type, effectiveWidths, { embedded, showAddColumn }),
    [type, effectiveWidths, embedded, showAddColumn],
  )
  const commitProperty = useCommitNoteProperty()
  const openRelation = useOpenRelation()

  // Toggle horizontal scroll shadow on the scroll parent directly so scrolling
  // sideways never re-renders the virtualized rows.
  useEffect(() => {
    const scrollParent = headerRef.current?.parentElement
    if (scrollParent === null || scrollParent === undefined) {
      return
    }
    const sync = (): void => {
      const scrolled = scrollParent.scrollLeft > 0
      if (scrollParent.hasAttribute('data-collection-scrolled-x') !== scrolled) {
        scrollParent.toggleAttribute('data-collection-scrolled-x', scrolled)
      }
    }
    sync()
    scrollParent.addEventListener('scroll', sync, { passive: true })
    return () => {
      scrollParent.removeEventListener('scroll', sync)
      scrollParent.removeAttribute('data-collection-scrolled-x')
    }
  }, [entries === undefined])

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

  // Step focus to the next/previous interactive cell on Tab or ArrowLeft/ArrowRight,
  // skipping any read-only columns that hold no focusable control.
  const stepFromCell = useCallback(
    (cellElement: HTMLElement | null, direction: 'next' | 'prev', activateInline: boolean) => {
      const container = headerRef.current?.parentElement
      if (container === null || container === undefined || cellElement === null) {
        return
      }
      const cells = Array.from(container.querySelectorAll<HTMLElement>('[data-collection-cell]'))
      const currentIndex = cells.indexOf(cellElement)
      if (currentIndex === -1) {
        return
      }
      const delta = direction === 'next' ? 1 : -1
      for (let index = currentIndex + delta; index >= 0 && index < cells.length; index += delta) {
        const target = cells[index]
        if (target === undefined) {
          return
        }
        const control = target.querySelector<HTMLElement>('button, input')
        if (control === null) {
          continue
        }
        control.focus()
        if (
          activateInline &&
          target.dataset.inlineCell === 'true' &&
          control.tagName === 'BUTTON'
        ) {
          control.click()
        }
        return
      }
    },
    [],
  )

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

  const startResize =
    (key: string, minRem: number, defaultRem: number, gutterOffsetRem = 0) =>
    (event: ReactPointerEvent<HTMLElement>) => {
      event.preventDefault()
      event.stopPropagation()
      const now = Date.now()
      const previous = lastResizeClickRef.current
      if (previous !== null && previous.key === key && now - previous.at < 350) {
        lastResizeClickRef.current = null
        onColumnWidthChange(key, defaultRem)
        return
      }
      const handle = event.currentTarget
      const cell = handle.parentElement
      if (cell === null) {
        return
      }
      const startX = event.clientX
      const startRem =
        columnWidths[key] ??
        Math.max(minRem, cell.getBoundingClientRect().width / 16 - gutterOffsetRem)
      let lastRem = startRem
      let moved = false
      handle.setPointerCapture(event.pointerId)
      setResizingKey(key)
      const previousCursor = document.body.style.cursor
      document.body.style.cursor = 'col-resize'
      const onMove = (moveEvent: PointerEvent): void => {
        if (Math.abs(moveEvent.clientX - startX) >= 2) {
          moved = true
        }
        lastRem = Math.max(
          minRem,
          Math.round((startRem + (moveEvent.clientX - startX) / 16) * 4) / 4,
        )
        setDraftWidths({ ...columnWidths, [key]: lastRem })
      }
      const finish = (): void => {
        handle.removeEventListener('pointermove', onMove)
        handle.removeEventListener('pointerup', finish)
        handle.removeEventListener('pointercancel', finish)
        document.body.style.cursor = previousCursor
        setResizingKey(null)
        setDraftWidths(null)
        if (moved) {
          lastResizeClickRef.current = null
          onColumnWidthChange(key, lastRem)
        } else {
          lastResizeClickRef.current = { key, at: Date.now() }
        }
      }
      handle.addEventListener('pointermove', onMove)
      handle.addEventListener('pointerup', finish)
      handle.addEventListener('pointercancel', finish)
    }

  const sortButton = (
    key: string,
    name: string,
    icon: ReactNode,
    className?: string,
  ): ReactNode => {
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
          'flex h-full min-w-0 flex-1 items-center gap-1.5 truncate text-left text-[12px] font-medium transition-colors hover:text-text focus-visible:outline-none',
          active ? 'text-text' : 'text-text-secondary',
          className,
        )}
      >
        {icon}
        <span className="truncate">{name}</span>
        {active ? (
          sort.direction === 'asc' ? (
            <ArrowUp aria-hidden className="size-3 shrink-0 text-accent" />
          ) : (
            <ArrowDown aria-hidden className="size-3 shrink-0 text-accent" />
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

  const gutterClass = embedded ? 'pl-8' : 'pl-12'

  // The last line of the table is always the next row.
  const newRow =
    draftTitle === null ? (
      <div
        style={{ minWidth: gridStyle.minWidth, height: rowHeight }}
        className="flex items-stretch border-b border-border bg-surface"
      >
        <button
          type="button"
          aria-label="New row"
          onClick={() => setDraftTitle('')}
          className={cn(
            'sticky left-0 flex h-full w-full items-center gap-1.5 pr-7 text-[13px] text-text-muted transition-colors hover:bg-surface-hover/60 hover:text-text-secondary',
            gutterClass,
          )}
        >
          <Plus aria-hidden className="size-3.5" />
          New
        </button>
      </div>
    ) : (
      <div
        style={{ minWidth: gridStyle.minWidth, height: rowHeight }}
        className="flex items-center border-b border-border bg-surface ring-2 ring-inset ring-accent"
      >
        <div className={cn('sticky left-0 flex h-full w-full items-center pr-7', gutterClass)}>
          <input
            autoFocus
            aria-label="New row title"
            placeholder="Title, then Enter"
            value={draftTitle}
            disabled={creating}
            onChange={(event) => setDraftTitle(event.target.value)}
            onKeyDown={onDraftKeyDown}
            onBlur={() => void commitDraft()}
            className="h-full w-full bg-transparent text-[13px] font-medium text-text outline-none placeholder:text-text-muted"
          />
        </div>
      </div>
    )

  return (
    <>
      <div
        ref={headerRef}
        style={gridStyle}
        className={cn(
          COLLECTION_GRID_CLASS,
          'sticky top-0 z-20 h-9 border-y border-border bg-surface text-[12px] font-medium leading-none text-text-secondary',
        )}
      >
        <span
          className={cn(
            'collection-sticky-col group/header relative z-30 flex h-full min-w-0 items-center border-r border-border bg-surface pr-2 transition-colors hover:bg-surface-hover/60',
            gutterClass,
          )}
        >
          {sortButton(
            TITLE_SORT_KEY,
            'Title',
            <Note aria-hidden className="size-3.5 shrink-0 text-text-muted" />,
          )}
          <span
            role="separator"
            aria-label="Resize Title"
            onPointerDown={startResize(
              TITLE_SORT_KEY,
              8,
              defaultTitleRem(embedded),
              titleGutterRem(embedded),
            )}
            onDoubleClick={() => {
              lastResizeClickRef.current = null
              onColumnWidthChange(TITLE_SORT_KEY, defaultTitleRem(embedded))
            }}
            className="group/resize absolute inset-y-0 -right-[3px] z-20 flex w-[7px] cursor-col-resize items-stretch justify-center"
          >
            <span
              aria-hidden
              className={cn(
                'h-full w-[2px] transition-colors',
                resizingKey === TITLE_SORT_KEY
                  ? 'bg-accent'
                  : 'bg-transparent group-hover/resize:bg-accent/70',
              )}
            />
          </span>
        </span>
        {type.properties.map((property) => {
          const TypeIcon = PROPERTY_TYPE_ICONS[property.type]
          return (
            <span
              key={property.key}
              className="group/header relative flex h-full min-w-0 items-center gap-1 border-r border-border px-2.5 transition-colors hover:bg-surface-hover/60"
            >
              {sortButton(
                property.key,
                property.name,
                <TypeIcon aria-hidden className="size-3.5 shrink-0 text-text-muted" />,
                property.type === 'number' || property.type === 'rating'
                  ? 'justify-end text-right'
                  : undefined,
              )}
              <ColumnHeaderMenu
                property={property}
                onSort={(direction, then) => sortBy(property.key, direction, then)}
                sorted={sorts.length > 0}
                onHide={onHideColumn === undefined ? undefined : () => onHideColumn(property.key)}
                onEditSchema={onEditSchema}
                onDelete={
                  onDeleteProperty === undefined ? undefined : () => onDeleteProperty(property.key)
                }
              />
              <span
                role="separator"
                aria-label={`Resize ${property.name}`}
                onPointerDown={startResize(property.key, 3.5, defaultColumnRem(property))}
                onDoubleClick={() => {
                  lastResizeClickRef.current = null
                  onColumnWidthChange(property.key, defaultColumnRem(property))
                }}
                className="group/resize absolute inset-y-0 -right-[3px] z-20 flex w-[7px] cursor-col-resize items-stretch justify-center"
              >
                <span
                  aria-hidden
                  className={cn(
                    'h-full w-[2px] transition-colors',
                    resizingKey === property.key
                      ? 'bg-accent'
                      : 'bg-transparent group-hover/resize:bg-accent/70',
                  )}
                />
              </span>
            </span>
          )
        })}
        <span className="flex h-full min-w-0 items-center justify-end border-r border-border px-2.5 transition-colors hover:bg-surface-hover/60">
          {sortButton(
            UPDATED_SORT_KEY,
            'Updated',
            <History aria-hidden className="size-3.5 shrink-0 text-text-muted" />,
            'justify-end text-right',
          )}
        </span>
        {showAddColumn ? (
          <span className="flex h-full items-center justify-center border-r border-border transition-colors hover:bg-surface-hover/60">
            <AddPropertyPopover onAdd={onAddProperty} onEditSchema={onEditSchema} />
          </span>
        ) : null}
        <span aria-hidden className="h-full" />
      </div>
      {entries.length === 0 ? (
        <>
          <p className={cn('py-8 pr-7 text-sm text-text-muted', gutterClass)}>
            No #{tag} notes yet.
          </p>
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
                  style={{ minWidth: gridStyle.minWidth, height: rowHeight }}
                  className="flex select-none items-center border-b border-border bg-surface-sunken/60"
                >
                  <div className={cn('sticky left-0 flex items-center gap-2 pr-4', gutterClass)}>
                    {item.color === null ? null : (
                      <span aria-hidden className={cn('size-2 rounded-full', item.color)} />
                    )}
                    <span className="text-xs font-semibold leading-none text-text">
                      {item.label}
                    </span>
                    <span className="text-xs leading-none tabular-nums text-text-muted">
                      {item.count}
                    </span>
                  </div>
                </div>
              ) : (
                <CollectionRow
                  key={item.entry.path}
                  entry={item.entry}
                  gridStyle={gridStyle}
                  rowHeight={rowHeight}
                  selected={isSelected(item.entry.path)}
                  openTasks={taskCounts[item.entry.path] ?? 0}
                  embedded={embedded}
                  showAddColumn={showAddColumn}
                  onSelect={clickSelect}
                  onToggle={handleToggle}
                  onOpen={onOpen}
                >
                  {type.properties.map((property) => {
                    const value = item.entry.properties[property.key]
                    const isReadOnlyField =
                      editableKeys !== undefined && !editableKeys.has(property.key)
                    const cell = rawKeys?.has(property.key) ? (
                      <span className="min-w-0 truncate text-[13px] text-text-secondary">
                        {value?.value ?? '—'}
                      </span>
                    ) : (
                      <CollectionCell
                        property={property}
                        value={value}
                        selected={isSelected(item.entry.path)}
                      />
                    )
                    if (isReadOnlyField) {
                      return (
                        <span
                          key={property.key}
                          title="Read-only because this collection has conflicting property types"
                          className="flex h-full min-w-0 items-center border-r border-border px-2.5"
                        >
                          {cell}
                        </span>
                      )
                    }
                    const isInteractiveType = !READ_ONLY_PROPERTY_TYPES.has(property.type)
                    const isInline = INLINE_INPUT_TYPES.has(property.type)
                    return (
                      <div
                        key={property.key}
                        data-collection-cell={isInteractiveType ? '' : undefined}
                        data-inline-cell={isInline ? 'true' : undefined}
                        onKeyDown={(event) => {
                          if (
                            event.defaultPrevented ||
                            (event.target as HTMLElement | null)?.tagName === 'INPUT'
                          ) {
                            return
                          }
                          if (event.key === 'ArrowRight') {
                            event.preventDefault()
                            stepFromCell(event.currentTarget, 'next', false)
                          } else if (event.key === 'ArrowLeft') {
                            event.preventDefault()
                            stepFromCell(event.currentTarget, 'prev', false)
                          }
                        }}
                        className="flex h-full min-w-0 items-stretch border-r border-border"
                      >
                        <PropertyValueEditor
                          property={property}
                          value={value}
                          variant="table-cell"
                          onCommit={(next) => commitProperty(item.entry.path, property.key, next)}
                          onOpenRelation={openRelation}
                          onStepCell={(direction) => {
                            const activeCell =
                              (document.activeElement as HTMLElement | null)?.closest<HTMLElement>(
                                '[data-collection-cell]',
                              ) ?? null
                            stepFromCell(activeCell, direction, true)
                          }}
                        >
                          {cell}
                        </PropertyValueEditor>
                      </div>
                    )
                  })}
                </CollectionRow>
              )
            }
          </Virtualizer>
          {newRow}
          <div
            style={gridStyle}
            className={cn(
              COLLECTION_GRID_CLASS,
              'h-8 bg-surface text-xs tabular-nums text-text-muted',
            )}
          >
            <span
              className={cn(
                'collection-sticky-col z-10 flex h-full items-center bg-surface pr-2',
                gutterClass,
              )}
            >
              {`${entries.length} ${entries.length === 1 ? 'note' : 'notes'}`}
            </span>
            {type.properties.map((property, index) => (
              <span
                key={property.key}
                className={cn(
                  'flex h-full min-w-0 items-center truncate px-2.5',
                  (property.type === 'number' || property.type === 'rating') &&
                    'justify-end text-right',
                )}
              >
                <span className="truncate">{aggregates[index]}</span>
              </span>
            ))}
            <span />
            {showAddColumn ? <span /> : null}
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
