import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { Virtualizer } from 'virtua'
import {
  TITLE_SORT_KEY,
  type CollectionEntry,
  type CollectionSort,
  type TagProperty,
  type TagPropertyType,
  type TagType,
} from '@kore/core'
import { tableGroupRows } from '@/components/all-notes/collection-board'
import { CollectionCell } from '@/components/all-notes/collection-cell'
import { columnAggregate } from '@/components/all-notes/collection-table'
import { ArrowDown, ArrowUp, Note, Plus } from '@/components/icons'
import { PROPERTY_TYPE_ICONS } from '@/components/tags/property-type-icons'
import { useCommitNoteProperty } from '@/lib/tags/use-commit-note-property'
import { useOpenRelation } from '@/lib/tags/use-open-relation'
import { cn } from '@/lib/utils'
import { hapticImpactLight } from '@/mobile/haptics'
import { MobileCellEditorDrawer, type MobileCellTarget } from './mobile-cell-editor-drawer'
import { mobileColumnWidth } from './mobile-type-view'
import './mobile-collection-table.css'

/** One row's height: exact 44pt iOS touch target with crisp horizontal rule. */
export const MOBILE_TABLE_ROW_HEIGHT = 44
/** A group's header band, when the table is grouped. */
const GROUP_HEIGHT = 36
/** The column header band. */
const HEADER_HEIGHT = 36
/** The compact frozen row-number rail. */
const NUMBER_WIDTH = 32
/** The frozen title column: balanced for titles while showing columns beside it. */
const TITLE_WIDTH = 166

const READ_ONLY_TYPES: ReadonlySet<TagPropertyType> = new Set([
  'rollup',
  'reverse',
  'formula',
  'created',
  'updated',
])

interface MobileCollectionTableProps {
  entries: readonly CollectionEntry[]
  /** The schema with hidden columns left out: what the table shows. */
  type: TagType
  /** Group the rows by this field (the board's lanes, empty ones left out); `null` is flat. */
  groupProperty?: TagProperty | null
  /** Active sort chain; enables tap-to-sort column headers when paired with `onSortChange`. */
  sorts?: readonly CollectionSort[]
  onSortChange?: ((sorts: readonly CollectionSort[]) => void) | undefined
  /** The type's name, for the table's accessible label. */
  label: string
  onOpen: (path: string) => void
  /** Create a row titled `title`; resolves once it is written. Absent: no "New" row. */
  onCreate?: ((title: string) => Promise<void>) | undefined
  /**
   * Inline in a note: the table takes its rows' height (the note scrolls,
   * not the table), scrolls only sideways, and renders its few rows without
   * the virtualizer.
   */
  embedded?: boolean
}

/**
 * A Notion-grade collection table on a phone: crisp horizontal and vertical
 * gridlines, a compact frozen `#` + `Title` pane, typed column headers with
 * tap-to-sort, instant checkbox toggles, and a touch-native bottom drawer
 * editor for every property type.
 */
export function MobileCollectionTable({
  entries,
  type,
  groupProperty = null,
  sorts = [],
  onSortChange,
  label,
  onOpen,
  onCreate,
  embedded = false,
}: MobileCollectionTableProps): ReactElement {
  const items = useMemo(() => tableItems(entries, groupProperty), [entries, groupProperty])
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const commitProperty = useCommitNoteProperty()
  const openRelation = useOpenRelation()
  const [editingCell, setEditingCell] = useState<MobileCellTarget | null>(null)
  const widths = type.properties.map(mobileColumnWidth)
  const frozenWidth = NUMBER_WIDTH + TITLE_WIDTH
  const totalWidth = frozenWidth + widths.reduce((sum, width) => sum + width, 0)
  const aggregates = useMemo(
    () => (embedded ? [] : type.properties.map((property) => columnAggregate(property, entries))),
    [embedded, type.properties, entries],
  )

  // Block horizontal rubber-band dragging past either edge on iOS WKWebView:
  // CSS `overscroll-behavior` stops momentum bounce, and canceling the first
  // outward `touchmove` keeps the frozen `#`/`Title` pane locked to the left
  // bezel even when the user drags right from `scrollLeft === 0`.
  useEffect(() => {
    const element = scrollRef.current
    if (element === null) {
      return
    }
    let startX = 0
    let startY = 0
    let prevX = 0
    let axis: 'none' | 'x' | 'y' = 'none'

    const onTouchStart = (event: TouchEvent): void => {
      const touch = event.touches[0]
      if (touch === undefined) {
        return
      }
      startX = touch.clientX
      startY = touch.clientY
      prevX = touch.clientX
      axis = 'none'
    }

    const onTouchMove = (event: TouchEvent): void => {
      const touch = event.touches[0]
      if (touch === undefined) {
        return
      }
      const totalDx = touch.clientX - startX
      const totalDy = touch.clientY - startY
      const stepDx = touch.clientX - prevX
      prevX = touch.clientX

      const maxScrollLeft = element.scrollWidth - element.clientWidth
      const pullingPastLeft = stepDx > 0 && element.scrollLeft <= 0
      const pullingPastRight = stepDx < 0 && element.scrollLeft >= maxScrollLeft - 1

      if (axis === 'none') {
        const absX = Math.abs(totalDx)
        const absY = Math.abs(totalDy)
        if (absX >= 4 || absY >= 4) {
          axis = absX > absY ? 'x' : 'y'
        } else if (absX > absY && (maxScrollLeft <= 0 || pullingPastLeft || pullingPastRight)) {
          event.preventDefault()
          return
        } else {
          return
        }
      }

      if (axis !== 'x') {
        return
      }

      if (maxScrollLeft <= 0 || pullingPastLeft || pullingPastRight) {
        event.preventDefault()
      }
    }

    const resetAxis = (): void => {
      axis = 'none'
    }

    element.addEventListener('touchstart', onTouchStart, { passive: true })
    element.addEventListener('touchmove', onTouchMove, { passive: false })
    element.addEventListener('touchend', resetAxis, { passive: true })
    element.addEventListener('touchcancel', resetAxis, { passive: true })
    return () => {
      element.removeEventListener('touchstart', onTouchStart)
      element.removeEventListener('touchmove', onTouchMove)
      element.removeEventListener('touchend', resetAxis)
      element.removeEventListener('touchcancel', resetAxis)
    }
  }, [])

  const primary = sorts[0] ?? null
  const cycleSort = (key: string): void => {
    if (onSortChange === undefined) {
      return
    }
    hapticImpactLight()
    if (primary === null || primary.key !== key || sorts.length > 1) {
      onSortChange([{ key, direction: 'asc' }])
    } else if (primary.direction === 'asc') {
      onSortChange([{ key, direction: 'desc' }])
    } else {
      onSortChange([])
    }
  }

  const sortFor = (key: string): 'asc' | 'desc' | null => {
    const match = sorts.find((sort) => sort.key === key)
    return match === undefined ? null : match.direction
  }

  const renderItem = (item: TableItem): ReactElement => {
    if (item.kind === 'group') {
      return (
        <div
          key={item.id}
          role="row"
          className="flex border-b border-border bg-surface-sunken/70"
          style={{ height: GROUP_HEIGHT }}
        >
          <div
            role="rowheader"
            aria-colspan={type.properties.length + 2}
            className="sticky left-0 z-10 flex h-full items-center bg-background"
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-surface-sunken/70"
            />
            <span
              aria-hidden
              className="relative z-10 flex shrink-0 justify-center"
              style={{ width: NUMBER_WIDTH }}
            >
              <span className={cn('size-2 rounded-full', item.color ?? 'bg-text-muted/40')} />
            </span>
            <span className="relative z-10 truncate px-2 text-[12px] font-semibold text-text">
              {item.label}
            </span>
            <span className="relative z-10 pr-3 text-[12px] tabular-nums text-text-muted">
              {item.count}
            </span>
          </div>
        </div>
      )
    }
    const { entry, number: index } = item
    return (
      <div
        key={entry.path}
        role="row"
        data-note-path={entry.path}
        className="group flex border-b border-border bg-background"
        style={{ height: MOBILE_TABLE_ROW_HEIGHT }}
      >
        <div
          role="cell"
          className="sticky left-0 z-10 flex items-center justify-center border-r border-border bg-background text-[11px] tabular-nums text-text-muted/80"
          style={{ width: NUMBER_WIDTH, minWidth: NUMBER_WIDTH }}
        >
          {index}
        </div>
        <div
          role="rowheader"
          className="mobile-table-frozen-edge sticky z-10 flex border-r border-border-strong/70 bg-background"
          style={{ left: NUMBER_WIDTH, width: TITLE_WIDTH, minWidth: TITLE_WIDTH }}
        >
          <button
            type="button"
            onClick={() => onOpen(entry.path)}
            className="flex h-full min-w-0 flex-1 items-center px-2.5 text-left text-[14px] font-medium text-text active:bg-surface-hover"
          >
            <span className="truncate">{entry.title}</span>
          </button>
        </div>
        {type.properties.map((property, column) => {
          const value = entry.properties[property.key]
          const isActive =
            editingCell?.entryPath === entry.path && editingCell.property.key === property.key
          const isReadOnly = READ_ONLY_TYPES.has(property.type)
          const isCheckbox = property.type === 'checkbox'
          const checked = value?.valueType === 'boolean' && value.value === 'true'
          return (
            <div
              key={property.key}
              role="cell"
              className="flex items-stretch border-r border-border"
              style={{ width: widths[column], minWidth: widths[column] }}
            >
              {isReadOnly ? (
                <span className="flex h-full w-full min-w-0 items-center px-2.5">
                  <CollectionCell property={property} value={value} selected={false} />
                </span>
              ) : isCheckbox ? (
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  aria-label={property.name}
                  onClick={() => {
                    hapticImpactLight()
                    commitProperty(entry.path, property.key, !checked)
                  }}
                  className="flex h-full w-full min-w-0 items-center justify-center px-2.5 active:bg-surface-hover focus-visible:outline-none"
                >
                  <CollectionCell property={property} value={value} selected={false} />
                </button>
              ) : (
                <button
                  type="button"
                  aria-label={`Edit ${property.name}`}
                  onClick={() => {
                    hapticImpactLight()
                    setEditingCell({
                      entryPath: entry.path,
                      entryTitle: entry.title,
                      property,
                      value,
                    })
                  }}
                  className={cn(
                    'flex h-full w-full min-w-0 items-center px-2.5 text-left transition-colors active:bg-surface-hover focus-visible:outline-none',
                    isActive && 'bg-accent-soft/50 ring-2 ring-inset ring-accent',
                  )}
                >
                  <CollectionCell property={property} value={value} selected={false} />
                </button>
              )}
            </div>
          )
        })}
        <div aria-hidden className="flex-1" />
      </div>
    )
  }

  return (
    <>
      <div
        ref={scrollRef}
        data-base-ui-swipe-ignore
        data-embedded={embedded ? '' : undefined}
        className={cn(
          'mobile-collection-table',
          embedded
            ? 'overflow-x-auto overflow-y-hidden overscroll-x-none'
            : 'min-h-0 flex-1 overflow-auto overscroll-none',
        )}
        // The frozen columns cast their edge only once the rest slides under
        // them; toggled on the element so a scroll never re-renders the rows.
        onScroll={(event) => {
          const scrolled = event.currentTarget.scrollLeft > 0
          if (event.currentTarget.hasAttribute('data-scrolled-x') !== scrolled) {
            event.currentTarget.toggleAttribute('data-scrolled-x', scrolled)
          }
        }}
        style={
          embedded
            ? undefined
            : {
                paddingTop: 'var(--mobile-header-height, 0px)',
                paddingBottom: 'var(--mobile-tab-bar-height, env(safe-area-inset-bottom))',
              }
        }
      >
        <div
          role="table"
          aria-label={label}
          aria-rowcount={entries.length + 1}
          style={{ width: `max(100%, ${totalWidth}px)` }}
        >
          <div
            role="row"
            className="sticky z-20 flex border-y border-border bg-background"
            // The band also paints the strip above it, so rows leaving the top
            // vanish under the glass header instead of peeking between the two.
            style={{
              top: 0,
              height: HEADER_HEIGHT,
              ...(embedded ? {} : { boxShadow: '0 -24px 0 0 var(--color-background)' }),
            }}
          >
            <HeaderCell frozenLeft={0} width={NUMBER_WIDTH} align="center">
              #
            </HeaderCell>
            <HeaderCell
              frozenLeft={NUMBER_WIDTH}
              width={TITLE_WIDTH}
              icon={<Note aria-hidden className="size-3.5 shrink-0 text-text-muted" />}
              sortDirection={sortFor(TITLE_SORT_KEY)}
              onSort={onSortChange === undefined ? undefined : () => cycleSort(TITLE_SORT_KEY)}
              edge
            >
              Title
            </HeaderCell>
            {type.properties.map((property, index) => {
              const TypeIcon = PROPERTY_TYPE_ICONS[property.type]
              return (
                <HeaderCell
                  key={property.key}
                  width={widths[index] ?? 0}
                  icon={<TypeIcon aria-hidden className="size-3.5 shrink-0 text-text-muted" />}
                  align={property.type === 'number' || property.type === 'rating' ? 'end' : 'start'}
                  sortDirection={sortFor(property.key)}
                  onSort={onSortChange === undefined ? undefined : () => cycleSort(property.key)}
                >
                  {property.name}
                </HeaderCell>
              )
            })}
            <div aria-hidden className="relative flex-1 bg-background">
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-surface-hover/40"
              />
            </div>
          </div>
          {embedded ? (
            items.map(renderItem)
          ) : (
            <Virtualizer
              scrollRef={scrollRef}
              data={items}
              itemSize={MOBILE_TABLE_ROW_HEIGHT}
              startMargin={HEADER_HEIGHT}
              bufferSize={640}
            >
              {renderItem}
            </Virtualizer>
          )}
          {onCreate === undefined ? null : <NewRow width={frozenWidth} onCreate={onCreate} />}
          {!embedded && entries.length > 0 ? (
            <div
              role="row"
              className="flex h-9 items-center border-b border-border bg-background text-[12px] tabular-nums text-text-muted"
            >
              <div
                className="mobile-table-frozen-edge sticky left-0 z-10 flex h-full items-center border-r border-border-strong/70 bg-background pr-2 pl-3"
                style={{ width: frozenWidth, minWidth: frozenWidth }}
              >
                {`${entries.length} ${entries.length === 1 ? 'note' : 'notes'}`}
              </div>
              {type.properties.map((property, index) => (
                <div
                  key={property.key}
                  className={cn(
                    'flex h-full items-center truncate border-r border-border px-2.5',
                    (property.type === 'number' || property.type === 'rating') &&
                      'justify-end text-right',
                  )}
                  style={{ width: widths[index], minWidth: widths[index] }}
                >
                  <span className="truncate">{aggregates[index]}</span>
                </div>
              ))}
              <div aria-hidden className="flex-1" />
            </div>
          ) : null}
        </div>
      </div>

      <MobileCellEditorDrawer
        target={editingCell}
        onClose={() => setEditingCell(null)}
        onCommit={commitProperty}
        onOpenRelation={openRelation}
      />
    </>
  )
}

function HeaderCell({
  children,
  width,
  frozenLeft,
  icon,
  align = 'start',
  edge = false,
  sortDirection = null,
  onSort,
}: {
  children: string
  width: number
  /** The sticky left offset for a frozen column; absent for a scrolling one. */
  frozenLeft?: number
  icon?: ReactNode
  align?: 'start' | 'center' | 'end'
  /** The last frozen column draws the edge the scrolling columns slide under. */
  edge?: boolean
  sortDirection?: 'asc' | 'desc' | null
  onSort?: (() => void) | undefined
}): ReactElement {
  const frozen = frozenLeft !== undefined
  const content = (
    <>
      {icon}
      <span className="truncate">{children}</span>
      {sortDirection === 'asc' ? (
        <ArrowUp aria-hidden className="size-3 shrink-0 text-accent" />
      ) : sortDirection === 'desc' ? (
        <ArrowDown aria-hidden className="size-3 shrink-0 text-accent" />
      ) : null}
    </>
  )
  return (
    <div
      role="columnheader"
      className={cn(
        'relative flex h-full items-center bg-background text-[12px] font-medium',
        sortDirection !== null ? 'text-text' : 'text-text-secondary',
        edge ? 'border-r border-border-strong/70' : 'border-r border-border',
        frozen && 'sticky z-30',
        edge && 'mobile-table-frozen-edge',
      )}
      style={{ width, minWidth: width, left: frozenLeft }}
    >
      <span aria-hidden className="pointer-events-none absolute inset-0 bg-surface-hover/40" />
      {onSort !== undefined ? (
        <button
          type="button"
          onClick={onSort}
          className={cn(
            'relative z-10 flex h-full w-full min-w-0 items-center gap-1.5 px-2.5 active:bg-surface-active focus-visible:outline-none',
            align === 'end'
              ? 'justify-end text-right'
              : align === 'center'
                ? 'justify-center'
                : 'text-left',
          )}
        >
          {content}
        </button>
      ) : (
        <div
          className={cn(
            'relative z-10 flex h-full w-full min-w-0 items-center gap-1.5',
            align === 'center'
              ? 'justify-center'
              : align === 'end'
                ? 'justify-end px-2.5'
                : 'px-2.5',
          )}
        >
          {content}
        </div>
      )}
    </div>
  )
}

/**
 * The table's last row: "New" until tapped, then a title field that creates
 * the note on Return (and on blur, when something was typed). Stays frozen
 * with the titles so it never scrolls out of reach sideways.
 */
function NewRow({
  width,
  onCreate,
}: {
  width: number
  onCreate: (title: string) => Promise<void>
}): ReactElement {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const busyRef = useRef(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  // The field appears because "New" was tapped: take the keyboard at once.
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
    }
  }, [editing])

  const submit = async (): Promise<void> => {
    const title = draft.trim()
    if (title === '' || busyRef.current) {
      setEditing(false)
      setDraft('')
      return
    }
    busyRef.current = true
    try {
      await onCreate(title)
      setDraft('')
    } finally {
      busyRef.current = false
    }
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void submit()
    } else if (event.key === 'Escape') {
      setDraft('')
      setEditing(false)
    }
  }

  return (
    <div
      role="row"
      className={cn(
        'flex border-b border-border bg-background',
        editing && 'ring-2 ring-inset ring-accent',
      )}
      style={{ height: MOBILE_TABLE_ROW_HEIGHT }}
    >
      <div
        className="sticky left-0 z-10 flex h-full items-center bg-background"
        style={{ width, minWidth: width }}
      >
        {editing ? (
          <>
            <span
              aria-hidden
              className="flex h-full shrink-0 items-center justify-center border-r border-border text-accent"
              style={{ width: NUMBER_WIDTH }}
            >
              <Plus className="size-3.5" />
            </span>
            <input
              ref={inputRef}
              aria-label="New note title"
              enterKeyHint="done"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={() => void submit()}
              placeholder="Title"
              className="h-full min-w-0 flex-1 bg-transparent px-2.5 text-[16px] font-medium text-text outline-none placeholder:text-text-muted"
            />
          </>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="flex h-full flex-1 items-center text-[14px] text-text-muted active:bg-surface-hover"
          >
            <span
              className="flex h-full shrink-0 items-center justify-center border-r border-border"
              style={{ width: NUMBER_WIDTH }}
            >
              <Plus aria-hidden className="size-3.5" />
            </span>
            <span className="px-2.5">New</span>
          </button>
        )}
      </div>
      <div aria-hidden className="flex-1" />
    </div>
  )
}

type TableItem =
  | { kind: 'group'; id: string; label: string; color: string | null; count: number }
  | { kind: 'row'; entry: CollectionEntry; number: number }

/**
 * The virtualized list's items: the rows numbered from 1, or, when grouped,
 * each group's header followed by its rows numbered from 1 again. Groups
 * follow the board's lanes so the two read alike.
 */
function tableItems(
  entries: readonly CollectionEntry[],
  groupProperty: TagProperty | null,
): TableItem[] {
  if (groupProperty === null) {
    return entries.map((entry, index) => ({ kind: 'row', entry, number: index + 1 }))
  }
  const items: TableItem[] = []
  for (const [groupIndex, column] of tableGroupRows(entries, groupProperty).entries()) {
    items.push({
      kind: 'group',
      id: `group:${groupIndex}:${column.label}`,
      label: column.label,
      color: column.color,
      count: column.entries.length,
    })
    for (const [index, entry] of column.entries.entries()) {
      items.push({ kind: 'row', entry, number: index + 1 })
    }
  }
  return items
}
