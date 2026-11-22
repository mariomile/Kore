import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
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
import { usePrefersReducedMotion } from '@/mobile/use-reduced-motion'
import { MobileCellEditorDrawer, type MobileCellTarget } from './mobile-cell-editor-drawer'
import { mobileColumnWidth } from './mobile-type-view'
import './mobile-collection-table.css'

/** One row's height: exact 44pt iOS touch target with crisp horizontal rule. */
export const MOBILE_TABLE_ROW_HEIGHT = 44
/** A group's header band, when the table is grouped. */
const GROUP_HEIGHT = 36
/** The column header band. */
const HEADER_HEIGHT = 36
/** The compact row-number rail. */
const NUMBER_WIDTH = 32
/** The title column: balanced for titles while showing columns beside it. */
const TITLE_WIDTH = 166
/** Horizontal travel (px) before a touch claims column panning over vertical scroll. */
const PAN_THRESHOLD_PX = 8
/** Velocity sampling window (ms) for post-release pan inertia. */
const VELOCITY_WINDOW_MS = 30
/** A velocity sample older than this at release means the finger stopped. */
const VELOCITY_STALE_MS = 4 * VELOCITY_WINDOW_MS
/** Minimum release speed (px/ms) to coast after finger lift. */
const MIN_INERTIA_VELOCITY = 0.15
/** Minimum horizontal viewport (px) kept open for scrollable columns when freezing on narrow screens. */
const MIN_PAN_VIEWPORT_WIDTH = 72

type PanGesture =
  | {
      phase: 'armed'
      pointerId: number
      startX: number
      startY: number
      startScrollX: number
    }
  | {
      phase: 'dragging'
      pointerId: number
      startX: number
      startScrollX: number
      lastX: number
      lastMoveTime: number
      sampleX: number
      sampleTime: number
      velocity: number
    }

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
  /** How many leading columns stay frozen while panning (`0` = none, `1` = Title, `2` = up to 1st property…). */
  frozenColumns?: number
  /** The type's name, for the table's accessible label. */
  label: string
  onOpen: (path: string) => void
  /** Create a row titled `title`; resolves once it is written. Absent: no "New" row. */
  onCreate?: ((title: string) => Promise<void>) | undefined
  /**
   * Inline in a note: the table takes its rows' height (the note scrolls,
   * not the table), pans columns sideways, and renders its few rows without
   * the virtualizer.
   */
  embedded?: boolean
}

/**
 * A Notion-grade collection table on a phone: crisp horizontal and vertical
 * gridlines, configurable frozen leading columns (`0` = none by default),
 * typed column headers with tap-to-sort, instant checkbox toggles, and a
 * touch-native bottom drawer editor for every property type.
 *
 * Vertical scrolling stays 100% native (`overflow-y: auto; overflow-x: hidden;
 * touch-action: pan-y`) while scrollable columns pan horizontally via a
 * strictly clamped GPU transform (`--table-scroll-x`), so iOS WKWebView can
 * never rubber-band the table away from the left bezel.
 */
export function MobileCollectionTable({
  entries,
  type,
  groupProperty = null,
  sorts = [],
  onSortChange,
  frozenColumns = 0,
  label,
  onOpen,
  onCreate,
  embedded = false,
}: MobileCollectionTableProps): ReactElement {
  const items = useMemo(() => tableItems(entries, groupProperty), [entries, groupProperty])
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const commitProperty = useCommitNoteProperty()
  const openRelation = useOpenRelation()
  const reducedMotion = usePrefersReducedMotion()
  const [editingCell, setEditingCell] = useState<MobileCellTarget | null>(null)
  const [viewportWidth, setViewportWidth] = useState<number | null>(null)
  const {
    frozenCount,
    frozenPropCount,
    frozenProps,
    scrollingProps,
    frozenPropWidths,
    scrollingPropWidths,
    baseLeftWidth,
    frozenWidth,
    panTrackWidth,
  } = useMemo(() => {
    const widths = type.properties.map(mobileColumnWidth)
    const baseWidth = NUMBER_WIDTH + TITLE_WIDTH
    let count = Math.min(Math.max(0, frozenColumns), 1 + type.properties.length)
    // On narrow phones, step down the effective frozen prefix whenever it would
    // overflow the viewport or trap remaining columns in an unreachable track.
    if (viewportWidth !== null && viewportWidth > 0) {
      while (count > 0) {
        const candidatePropWidths = widths.slice(0, count - 1)
        const candidateFrozenWidth =
          baseWidth + candidatePropWidths.reduce((sum, width) => sum + width, 0)
        const hasMoreColumns = count < 1 + type.properties.length
        const maxAllowed = hasMoreColumns ? viewportWidth - MIN_PAN_VIEWPORT_WIDTH : viewportWidth
        if (candidateFrozenWidth <= maxAllowed) {
          break
        }
        count -= 1
      }
    }
    const propCount = Math.max(0, count - 1)
    const leftProps = type.properties.slice(0, propCount)
    const rightProps = type.properties.slice(propCount)
    const leftWidths = widths.slice(0, propCount)
    const rightWidths = widths.slice(propCount)
    const pinnedWidth =
      count === 0 ? 0 : baseWidth + leftWidths.reduce((sum, width) => sum + width, 0)
    const rightWidth = rightWidths.reduce((sum, width) => sum + width, 0)
    return {
      frozenCount: count,
      frozenPropCount: propCount,
      frozenProps: leftProps,
      scrollingProps: rightProps,
      frozenPropWidths: leftWidths,
      scrollingPropWidths: rightWidths,
      baseLeftWidth: baseWidth,
      frozenWidth: pinnedWidth,
      panTrackWidth: count === 0 ? baseWidth + rightWidth : rightWidth,
    }
  }, [type.properties, frozenColumns, viewportWidth])
  const aggregates = useMemo(
    () => (embedded ? [] : type.properties.map((property) => columnAggregate(property, entries))),
    [embedded, type.properties, entries],
  )

  const scrollXRef = useRef(0)
  const gestureRef = useRef<PanGesture | null>(null)
  const suppressClickRef = useRef(false)
  const inertiaFrameRef = useRef<number | null>(null)

  const stopInertia = useCallback((): void => {
    if (inertiaFrameRef.current !== null) {
      cancelAnimationFrame(inertiaFrameRef.current)
      inertiaFrameRef.current = null
    }
  }, [])

  const maxScrollX = useCallback((): number => {
    const element = scrollRef.current
    if (element === null) {
      return 0
    }
    const availablePanWidth = Math.max(0, element.clientWidth - frozenWidth)
    return availablePanWidth <= 0 ? 0 : Math.max(0, panTrackWidth - availablePanWidth)
  }, [frozenWidth, panTrackWidth])

  const applyScrollX = useCallback(
    (next: number): number => {
      const element = scrollRef.current
      const clamped = Math.max(0, Math.min(maxScrollX(), next))
      scrollXRef.current = clamped
      if (element !== null) {
        element.style.setProperty('--table-scroll-x', `${clamped}px`)
        const scrolled = clamped > 0
        if (element.hasAttribute('data-scrolled-x') !== scrolled) {
          element.toggleAttribute('data-scrolled-x', scrolled)
        }
      }
      return clamped
    },
    [maxScrollX],
  )

  // Track container width so over-wide frozen prefixes step down gracefully,
  // and re-clamp horizontal offset whenever the container or column set resizes.
  useEffect(() => {
    const element = scrollRef.current
    if (element === null) {
      return
    }
    const syncWidth = (): void => {
      const nextWidth = element.clientWidth
      setViewportWidth((current) => (current === nextWidth ? current : nextWidth))
    }
    syncWidth()
    applyScrollX(scrollXRef.current)
    if (typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(() => {
      syncWidth()
      applyScrollX(scrollXRef.current)
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
      stopInertia()
    }
  }, [applyScrollX, stopInertia])

  const startInertia = useCallback(
    (initialVelocity: number): void => {
      stopInertia()
      if (reducedMotion || Math.abs(initialVelocity) < MIN_INERTIA_VELOCITY) {
        return
      }
      let velocity = initialVelocity
      let lastTime = performance.now()
      const step = (now: number): void => {
        const dt = Math.min(32, Math.max(1, now - lastTime))
        lastTime = now
        const previous = scrollXRef.current
        const next = applyScrollX(previous + velocity * dt)
        // Exponential friction tuned for ~16ms frames; hard-stop at either edge.
        velocity *= Math.pow(0.92, dt / 16)
        if (next === previous || Math.abs(velocity) < 0.03) {
          inertiaFrameRef.current = null
          return
        }
        inertiaFrameRef.current = requestAnimationFrame(step)
      }
      inertiaFrameRef.current = requestAnimationFrame(step)
    },
    [applyScrollX, reducedMotion, stopInertia],
  )

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.pointerType !== 'touch' || !event.isPrimary) {
      return
    }
    stopInertia()
    suppressClickRef.current = false
    gestureRef.current = {
      phase: 'armed',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScrollX: scrollXRef.current,
    }
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const gesture = gestureRef.current
    if (gesture === null || gesture.pointerId !== event.pointerId) {
      return
    }
    const deltaX = event.clientX - gesture.startX
    if (gesture.phase === 'armed') {
      const absX = Math.abs(deltaX)
      const absY = Math.abs(event.clientY - gesture.startY)
      if (absY >= PAN_THRESHOLD_PX && absY >= absX) {
        gestureRef.current = null
        return
      }
      if (absX < PAN_THRESHOLD_PX || absX <= absY) {
        return
      }
      const limit = maxScrollX()
      // Already at the boundary in the drag direction: do not capture or bounce.
      if (
        limit <= 0 ||
        (deltaX > 0 && gesture.startScrollX <= 0) ||
        (deltaX < 0 && gesture.startScrollX >= limit)
      ) {
        gestureRef.current = null
        return
      }
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // Synthetic test events have no live pointer to capture.
      }
      suppressClickRef.current = true
      const nextX = applyScrollX(gesture.startScrollX - deltaX)
      const now = performance.now()
      gestureRef.current = {
        phase: 'dragging',
        pointerId: gesture.pointerId,
        startX: gesture.startX,
        startScrollX: gesture.startScrollX,
        lastX: nextX,
        lastMoveTime: now,
        sampleX: nextX,
        sampleTime: now,
        velocity: 0,
      }
      return
    }

    const nextX = applyScrollX(gesture.startScrollX - deltaX)
    const now = performance.now()
    const elapsed = now - gesture.sampleTime
    gestureRef.current =
      elapsed >= VELOCITY_WINDOW_MS
        ? {
            ...gesture,
            lastX: nextX,
            lastMoveTime: now,
            velocity: (nextX - gesture.sampleX) / elapsed,
            sampleX: nextX,
            sampleTime: now,
          }
        : { ...gesture, lastX: nextX, lastMoveTime: now }
  }

  const releasePan = (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean): void => {
    const gesture = gestureRef.current
    if (gesture === null || gesture.pointerId !== event.pointerId) {
      return
    }
    gestureRef.current = null
    if (gesture.phase !== 'dragging') {
      return
    }
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    } catch {
      // Synthetic test events have no live pointer capture.
    }
    if (!cancelled) {
      const now = performance.now()
      const idleMs = now - gesture.lastMoveTime
      const sampleAge = now - gesture.sampleTime
      let releaseVelocity = 0
      if (idleMs <= VELOCITY_STALE_MS && sampleAge <= VELOCITY_STALE_MS) {
        releaseVelocity =
          gesture.velocity !== 0
            ? gesture.velocity
            : sampleAge > 0
              ? (gesture.lastX - gesture.sampleX) / sampleAge
              : 0
      }
      startInertia(releaseVelocity)
    }
  }

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>): void => {
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) || maxScrollX() <= 0) {
      return
    }
    stopInertia()
    applyScrollX(scrollXRef.current + event.deltaX)
  }

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

  const renderPropertyCell = (
    entry: CollectionEntry,
    property: TagProperty,
    width: number,
    options: { frozen?: boolean; edge?: boolean } = {},
  ): ReactElement => {
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
        className={cn(
          'flex shrink-0 items-stretch border-r',
          options.frozen && 'z-10 bg-background',
          options.edge ? 'mobile-table-frozen-edge border-border-strong/70' : 'border-border',
        )}
        style={{ width, minWidth: width }}
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
  }

  const renderNumberAndTitle = (
    entry: CollectionEntry,
    index: number,
    options: { frozen: boolean; titleEdge: boolean },
  ): ReactElement => (
    <>
      <div
        role="cell"
        className={cn(
          'flex shrink-0 items-center justify-center border-r border-border bg-background text-[11px] tabular-nums text-text-muted/80',
          options.frozen && 'relative z-10',
        )}
        style={{ width: NUMBER_WIDTH, minWidth: NUMBER_WIDTH }}
      >
        {index}
      </div>
      <div
        role="rowheader"
        className={cn(
          'flex shrink-0 border-r bg-background',
          options.frozen && 'z-10',
          options.titleEdge ? 'mobile-table-frozen-edge border-border-strong/70' : 'border-border',
        )}
        style={{ width: TITLE_WIDTH, minWidth: TITLE_WIDTH }}
      >
        <button
          type="button"
          onClick={() => onOpen(entry.path)}
          className="flex h-full min-w-0 flex-1 items-center px-2.5 text-left text-[14px] font-medium text-text active:bg-surface-hover"
        >
          <span className="truncate">{entry.title}</span>
        </button>
      </div>
    </>
  )

  const renderItem = (item: TableItem): ReactElement => {
    if (item.kind === 'group') {
      return (
        <div
          key={item.id}
          role="row"
          className="flex w-full border-b border-border bg-surface-sunken/70"
          style={{ height: GROUP_HEIGHT }}
        >
          <div
            role="rowheader"
            aria-colspan={type.properties.length + 2}
            className="flex h-full min-w-0 items-center"
          >
            <span
              aria-hidden
              className="flex shrink-0 justify-center"
              style={{ width: NUMBER_WIDTH }}
            >
              <span className={cn('size-2 rounded-full', item.color ?? 'bg-text-muted/40')} />
            </span>
            <span className="truncate px-2 text-[12px] font-semibold text-text">{item.label}</span>
            <span className="pr-3 text-[12px] tabular-nums text-text-muted">{item.count}</span>
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
        className="group flex w-full border-b border-border bg-background"
        style={{ height: MOBILE_TABLE_ROW_HEIGHT }}
      >
        {frozenCount >= 1 ? (
          <>
            {renderNumberAndTitle(entry, index, {
              frozen: true,
              titleEdge: frozenCount === 1,
            })}
            {frozenProps.map((property, column) =>
              renderPropertyCell(entry, property, frozenPropWidths[column] ?? 0, {
                frozen: true,
                edge: column === frozenProps.length - 1,
              }),
            )}
          </>
        ) : null}
        <div role="presentation" className="h-full min-w-0 flex-1 overflow-clip">
          <div
            role="presentation"
            className="mobile-table-pan-track flex h-full"
            style={{ minWidth: panTrackWidth }}
          >
            {frozenCount === 0
              ? renderNumberAndTitle(entry, index, { frozen: false, titleEdge: false })
              : null}
            {scrollingProps.map((property, column) =>
              renderPropertyCell(entry, property, scrollingPropWidths[column] ?? 0),
            )}
            <div aria-hidden className="flex-1" />
          </div>
        </div>
      </div>
    )
  }

  const renderHeaderProperty = (
    property: TagProperty,
    width: number,
    options: { frozen?: boolean; edge?: boolean } = {},
  ): ReactElement => {
    const TypeIcon = PROPERTY_TYPE_ICONS[property.type]
    return (
      <HeaderCell
        key={property.key}
        width={width}
        icon={<TypeIcon aria-hidden className="size-3.5 shrink-0 text-text-muted" />}
        align={property.type === 'number' || property.type === 'rating' ? 'end' : 'start'}
        sortDirection={sortFor(property.key)}
        onSort={onSortChange === undefined ? undefined : () => cycleSort(property.key)}
        frozen={options.frozen ?? false}
        edge={options.edge ?? false}
      >
        {property.name}
      </HeaderCell>
    )
  }

  return (
    <>
      <div
        ref={scrollRef}
        data-base-ui-swipe-ignore
        data-embedded={embedded ? '' : undefined}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => releasePan(event, false)}
        onPointerCancel={(event) => releasePan(event, true)}
        onWheel={handleWheel}
        onClickCapture={(event) => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false
            event.preventDefault()
            event.stopPropagation()
          }
        }}
        className={cn(
          'mobile-collection-table',
          embedded
            ? 'overflow-clip'
            : 'min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-x-none',
        )}
        style={
          embedded
            ? undefined
            : {
                paddingTop: 'var(--mobile-header-height, 0px)',
                paddingBottom: 'var(--mobile-tab-bar-height, env(safe-area-inset-bottom))',
              }
        }
      >
        <div role="table" aria-label={label} aria-rowcount={entries.length + 1} className="w-full">
          <div
            role="row"
            className="sticky z-20 flex w-full border-y border-border bg-background"
            // The band also paints the strip above it, so rows leaving the top
            // vanish under the glass header instead of peeking between the two.
            style={{
              top: 0,
              height: HEADER_HEIGHT,
              ...(embedded ? {} : { boxShadow: '0 -24px 0 0 var(--color-background)' }),
            }}
          >
            {frozenCount >= 1 ? (
              <>
                <HeaderCell width={NUMBER_WIDTH} align="center" frozen>
                  #
                </HeaderCell>
                <HeaderCell
                  width={TITLE_WIDTH}
                  icon={<Note aria-hidden className="size-3.5 shrink-0 text-text-muted" />}
                  sortDirection={sortFor(TITLE_SORT_KEY)}
                  onSort={onSortChange === undefined ? undefined : () => cycleSort(TITLE_SORT_KEY)}
                  frozen
                  edge={frozenCount === 1}
                >
                  Title
                </HeaderCell>
                {frozenProps.map((property, index) =>
                  renderHeaderProperty(property, frozenPropWidths[index] ?? 0, {
                    frozen: true,
                    edge: index === frozenProps.length - 1,
                  }),
                )}
              </>
            ) : null}
            <div role="presentation" className="h-full min-w-0 flex-1 overflow-clip">
              <div
                role="presentation"
                className="mobile-table-pan-track flex h-full"
                style={{ minWidth: panTrackWidth }}
              >
                {frozenCount === 0 ? (
                  <>
                    <HeaderCell width={NUMBER_WIDTH} align="center">
                      #
                    </HeaderCell>
                    <HeaderCell
                      width={TITLE_WIDTH}
                      icon={<Note aria-hidden className="size-3.5 shrink-0 text-text-muted" />}
                      sortDirection={sortFor(TITLE_SORT_KEY)}
                      onSort={
                        onSortChange === undefined ? undefined : () => cycleSort(TITLE_SORT_KEY)
                      }
                    >
                      Title
                    </HeaderCell>
                  </>
                ) : null}
                {scrollingProps.map((property, index) =>
                  renderHeaderProperty(property, scrollingPropWidths[index] ?? 0),
                )}
                <div aria-hidden className="relative flex-1 bg-background">
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 bg-surface-hover/40"
                  />
                </div>
              </div>
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
          {onCreate === undefined ? null : (
            <NewRow
              width={frozenWidth > 0 ? frozenWidth : baseLeftWidth}
              frozenEdge={frozenCount > 0}
              onCreate={onCreate}
            />
          )}
          {!embedded && entries.length > 0 ? (
            <div
              role="row"
              className="flex h-9 w-full items-stretch border-b border-border bg-background text-[12px] tabular-nums text-text-muted"
            >
              {frozenCount >= 1 ? (
                <>
                  <div
                    className={cn(
                      'z-10 flex h-full shrink-0 items-center border-r bg-background pr-2 pl-3',
                      frozenCount === 1
                        ? 'mobile-table-frozen-edge border-border-strong/70'
                        : 'border-border',
                    )}
                    style={{ width: baseLeftWidth, minWidth: baseLeftWidth }}
                  >
                    {`${entries.length} ${entries.length === 1 ? 'note' : 'notes'}`}
                  </div>
                  {frozenProps.map((property, index) => (
                    <div
                      key={property.key}
                      className={cn(
                        'z-10 flex h-full shrink-0 items-center truncate border-r bg-background px-2.5',
                        index === frozenProps.length - 1
                          ? 'mobile-table-frozen-edge border-border-strong/70'
                          : 'border-border',
                        (property.type === 'number' || property.type === 'rating') &&
                          'justify-end text-right',
                      )}
                      style={{ width: frozenPropWidths[index], minWidth: frozenPropWidths[index] }}
                    >
                      <span className="truncate">{aggregates[index]}</span>
                    </div>
                  ))}
                </>
              ) : null}
              <div role="presentation" className="h-full min-w-0 flex-1 overflow-clip">
                <div
                  role="presentation"
                  className="mobile-table-pan-track flex h-full"
                  style={{ minWidth: panTrackWidth }}
                >
                  {frozenCount === 0 ? (
                    <div
                      className="flex h-full shrink-0 items-center border-r border-border pr-2 pl-3"
                      style={{ width: baseLeftWidth, minWidth: baseLeftWidth }}
                    >
                      {`${entries.length} ${entries.length === 1 ? 'note' : 'notes'}`}
                    </div>
                  ) : null}
                  {scrollingProps.map((property, index) => (
                    <div
                      key={property.key}
                      className={cn(
                        'flex h-full shrink-0 items-center truncate border-r border-border px-2.5',
                        (property.type === 'number' || property.type === 'rating') &&
                          'justify-end text-right',
                      )}
                      style={{
                        width: scrollingPropWidths[index],
                        minWidth: scrollingPropWidths[index],
                      }}
                    >
                      <span className="truncate">{aggregates[frozenPropCount + index]}</span>
                    </div>
                  ))}
                  <div aria-hidden className="flex-1" />
                </div>
              </div>
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
  frozen = false,
  icon,
  align = 'start',
  edge = false,
  sortDirection = null,
  onSort,
}: {
  children: string
  width: number
  /** Whether this column belongs to the anchored left pane. */
  frozen?: boolean
  icon?: ReactNode
  align?: 'start' | 'center' | 'end'
  /** The last frozen column draws the edge the scrolling columns slide under. */
  edge?: boolean
  sortDirection?: 'asc' | 'desc' | null
  onSort?: (() => void) | undefined
}): ReactElement {
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
        'relative flex h-full shrink-0 items-center bg-background text-[12px] font-medium',
        sortDirection !== null ? 'text-text' : 'text-text-secondary',
        edge ? 'border-r border-border-strong/70' : 'border-r border-border',
        frozen && 'z-20',
        edge && 'mobile-table-frozen-edge',
      )}
      style={{ width, minWidth: width }}
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
 * the note on Return (and on blur, when something was typed). Stays anchored
 * on the left so it never pans out of reach.
 */
function NewRow({
  width,
  frozenEdge,
  onCreate,
}: {
  width: number
  frozenEdge: boolean
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
        'flex w-full border-b border-border bg-background',
        editing && 'ring-2 ring-inset ring-accent',
      )}
      style={{ height: MOBILE_TABLE_ROW_HEIGHT }}
    >
      <div
        className={cn(
          'flex h-full items-center bg-background',
          frozenEdge && 'mobile-table-frozen-edge z-10 border-r border-border-strong/70',
        )}
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
