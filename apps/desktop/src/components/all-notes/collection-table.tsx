import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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
import { CollectionCell } from './collection-cell'
import { collectionGridStyle, COLLECTION_GRID_CLASS } from './collection-grid'
import { CollectionRow } from './collection-row'
import { TABLE_HEADER_CHROME } from './table-chrome'

interface CollectionTableProps {
  /** `undefined` while the collection query settles. */
  entries: CollectionEntry[] | undefined
  tag: string
  /** The tag's schema, hidden columns already filtered out. */
  type: TagType
  selection: ListSelection
  sort: CollectionSort | null
  onSortChange: (sort: CollectionSort | null) => void
  /** Manual column widths (rem, per property key) — a header-edge drag. */
  columnWidths: Record<string, number>
  onColumnWidthChange: (key: string, rem: number) => void
  /** Open the tag's schema dialog (the header's "+" — add a property). */
  onEditSchema: () => void
  onOpen: (path: string, event?: ModClickEvent) => void
  registerScrollToIndex: (scrollToIndex: (index: number) => void) => void
}

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
  sort,
  onSortChange,
  columnWidths,
  onColumnWidthChange,
  onEditSchema,
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
  // The footer sums are O(rows × columns): memoized so a selection click or
  // a resize drag's per-pointermove re-render reuses them.
  const aggregates = useMemo(
    () => type.properties.map((property) => columnAggregate(property, entries ?? [])),
    [type.properties, entries],
  )
  // The rows' open-task badges (the project pulse) — one batched read.
  const entryPaths = useMemo(() => (entries ?? []).map((entry) => entry.path), [entries])
  const taskCounts = useOpenTaskCounts(entryPaths)

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
      if (index >= 0) {
        virtualizerRef.current?.scrollToIndex(index, { align: 'nearest' })
      }
    })
  }, [registerScrollToIndex])

  const cycleSort = (key: string): void => {
    if (sort === null || sort.key !== key) {
      onSortChange({ key, direction: 'asc' })
    } else if (sort.direction === 'asc') {
      onSortChange({ key, direction: 'desc' })
    } else {
      onSortChange(null)
    }
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
    const active = sort?.key === key
    // A plain button carries no columnheader role, so `aria-sort` wouldn't
    // apply — the sort state rides the accessible name.
    const sortState = !active
      ? ''
      : sort.direction === 'asc'
        ? ', sorted ascending'
        : ', sorted descending'
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
      </button>
    )
  }

  if (entries === undefined) {
    return null
  }
  return (
    <>
      <div style={gridStyle} className={cn(COLLECTION_GRID_CLASS, TABLE_HEADER_CHROME)}>
        {sortButton(TITLE_SORT_KEY, 'Title')}
        {type.properties.map((property) => (
          <span key={property.key} className="relative flex min-w-0 items-center">
            {sortButton(property.key, property.name)}
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
          <button
            type="button"
            aria-label="Add property"
            title="Add a property"
            onClick={onEditSchema}
            className="flex size-4 shrink-0 items-center justify-center rounded text-text-muted hover:text-text-secondary"
          >
            <Plus aria-hidden className="size-3" />
          </button>
        </span>
      </div>
      {entries.length === 0 ? (
        <p className="py-8 pl-12 pr-7 text-sm text-text-muted">No notes tagged #{tag}.</p>
      ) : (
        <>
          <Virtualizer
            ref={virtualizerRef}
            as="ul"
            item="li"
            data={entries}
            itemSize={rowHeight}
            bufferSize={10 * rowHeight}
          >
            {(entry) => (
              <CollectionRow
                key={entry.path}
                entry={entry}
                gridStyle={gridStyle}
                selected={isSelected(entry.path)}
                openTasks={taskCounts[entry.path] ?? 0}
                onSelect={clickSelect}
                onToggle={handleToggle}
                onOpen={onOpen}
              >
                {type.properties.map((property) => (
                  <PropertyValueEditor
                    key={property.key}
                    property={property}
                    value={entry.properties[property.key]}
                    onCommit={(value) => commitProperty(entry.path, property.key, value)}
                    onOpenRelation={openRelation}
                  >
                    <CollectionCell
                      property={property}
                      value={entry.properties[property.key]}
                      selected={isSelected(entry.path)}
                    />
                  </PropertyValueEditor>
                ))}
              </CollectionRow>
            )}
          </Virtualizer>
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
