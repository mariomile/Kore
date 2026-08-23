import { useCallback, useEffect, useMemo, useRef, type MouseEvent, type ReactElement } from 'react'
import { Virtualizer, type VirtualizerHandle } from 'virtua'
import {
  DENSITY_ROW_HEIGHT,
  type CollectionEntry,
  type CollectionSort,
  type TagType,
} from '@reflect/core'
import { ArrowDown, ArrowUp } from '@/components/icons'
import { PropertyValueEditor } from '@/components/tags/property-editors'
import type { ListSelection } from '@/lib/selection/use-list-selection'
import { useCommitNoteProperty } from '@/lib/tags/use-commit-note-property'
import { cn } from '@/lib/utils'
import { useSettings } from '@/providers/settings-provider'
import type { ModClickEvent } from '@/lib/windows/open-in-new-window'
import { CollectionCell } from './collection-cell'
import { collectionGridStyle, COLLECTION_GRID_CLASS } from './collection-grid'
import { CollectionRow } from './collection-row'

interface CollectionTableProps {
  /** `undefined` while the collection query settles. */
  entries: CollectionEntry[] | undefined
  tag: string
  /** The tag's schema — one column per property. */
  type: TagType
  selection: ListSelection
  sort: CollectionSort | null
  onSortChange: (sort: CollectionSort | null) => void
  onOpen: (path: string, event?: ModClickEvent) => void
  registerScrollToIndex: (scrollToIndex: (index: number) => void) => void
}

/**
 * The Collection table (TDR 0005): the All Notes table's shape — sticky
 * header over virtualized fixed-height rows — with typed columns from the
 * tag's schema. Property headers sort (asc → desc → off); missing values
 * always sort last (the query's contract).
 */
export function CollectionTable({
  entries,
  tag,
  type,
  selection,
  sort,
  onSortChange,
  onOpen,
  registerScrollToIndex,
}: CollectionTableProps): ReactElement | null {
  const density = useSettings().settings.uiDensity
  const rowHeight = DENSITY_ROW_HEIGHT[density] ?? DENSITY_ROW_HEIGHT.default
  const rows = entries ?? []
  const { clickSelect, isSelected } = selection
  const virtualizerRef = useRef<VirtualizerHandle>(null)
  const gridStyle = useMemo(() => collectionGridStyle(type), [type])
  const commitProperty = useCommitNoteProperty()

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

  if (entries === undefined) {
    return null
  }
  return (
    <>
      <div
        style={gridStyle}
        className={cn(
          COLLECTION_GRID_CLASS,
          'sticky top-0 z-10 border-b border-border bg-surface py-3 text-[13px] font-medium leading-none text-text-secondary shadow-sm',
        )}
      >
        <span>Subject</span>
        {type.properties.map((property) => {
          const active = sort?.key === property.key
          // A plain button carries no columnheader role, so `aria-sort`
          // wouldn't apply — the sort state rides the accessible name.
          const sortState = !active
            ? ''
            : sort.direction === 'asc'
              ? ', sorted ascending'
              : ', sorted descending'
          return (
            <button
              key={property.key}
              type="button"
              onClick={() => cycleSort(property.key)}
              aria-label={`Sort by ${property.name}${sortState}`}
              className={cn(
                'flex items-center gap-1 truncate text-left font-medium transition-colors hover:text-text',
                active ? 'text-text' : 'text-text-secondary',
              )}
            >
              <span className="truncate">{property.name}</span>
              {active ? (
                sort.direction === 'asc' ? (
                  <ArrowUp aria-hidden className="size-3 shrink-0" />
                ) : (
                  <ArrowDown aria-hidden className="size-3 shrink-0" />
                )
              ) : null}
            </button>
          )
        })}
        <span className="text-right">Updated</span>
      </div>
      {entries.length === 0 ? (
        <p className="py-8 pl-12 pr-7 text-sm text-text-muted">No notes tagged #{tag}.</p>
      ) : (
        <Virtualizer
          ref={virtualizerRef}
          as="ul"
          item="li"
          data={rows}
          itemSize={rowHeight}
          bufferSize={10 * rowHeight}
        >
          {(entry) => (
            <CollectionRow
              key={entry.path}
              entry={entry}
              gridStyle={gridStyle}
              selected={isSelected(entry.path)}
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
      )}
    </>
  )
}
