import {
  memo,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react'
import { Virtualizer } from 'virtua'
import {
  TIMELINE_ZOOMS,
  type CollectionEntry,
  type TagProperty,
  type TagType,
  type TimelineZoom,
} from '@kore/core'
import { ChevronLeft, ChevronRight, Plus } from '@/components/icons'
import { useOptimisticMoves } from '@/hooks/use-optimistic-moves'
import {
  daysBetween,
  shiftSpan,
  type TimelineBar,
  type TimelineFields,
  type TimelineSpan,
} from '@/lib/tags/timeline-layout'
import { useCommitNoteProperties } from '@/lib/tags/use-commit-note-property'
import { useCreateCollectionNote } from '@/lib/tags/use-create-collection-note'
import { useTimelineLayout, type TimelineItem } from '@/lib/tags/use-timeline-layout'
import type { ModClickEvent } from '@/lib/windows/open-in-new-window'
import { cn } from '@/lib/utils'
import { timelineZoomLabel } from './collection-view-model'
import { TimelineHeader, timelineGridStyle } from './timeline-header'

/**
 * The Collection's timeline (a Gantt view): one row per note, a bar from its
 * start date to its end date on a scrolling day axis. Dragging a bar moves
 * both dates, dragging an edge moves one; each drop writes the frontmatter,
 * so the vault stays plain Markdown any agent (or Obsidian) can read.
 */

/** Pixels a press must travel before it drags a bar instead of opening it. */
const DRAG_THRESHOLD = 4
const ROW_HEIGHT = 36
const HEADER_HEIGHT = 52
const TITLE_WIDTH = 240

type DragEdge = 'move' | 'start' | 'end'

interface DragState {
  readonly path: string
  readonly edge: DragEdge
  readonly span: TimelineSpan
  readonly delta: number
}

interface CollectionTimelineProps {
  entries: readonly CollectionEntry[] | undefined
  fields: TimelineFields
  /** Rows group under this field's values (the view's grouping), or flat. */
  groupProperty: TagProperty | null
  zoom: TimelineZoom
  onZoomChange: (zoom: TimelineZoom) => void
  tag: string
  type: TagType
  onOpen: (path: string, event?: ModClickEvent) => void
}

export function CollectionTimeline({
  entries,
  fields,
  groupProperty,
  zoom,
  onZoomChange,
  tag,
  type,
  onOpen,
}: CollectionTimelineProps): ReactElement {
  const layout = useTimelineLayout(entries, fields, groupProperty, zoom)
  const { items, window, today, todayOffset, dayWidth } = layout
  const commitProperties = useCommitNoteProperties()
  const createNote = useCreateCollectionNote(tag, type)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const { moves, record } = useOptimisticMoves<TimelineSpan>(entries)
  const trackWidth = window.days * dayWidth
  const gridStyle = timelineGridStyle(dayWidth, zoom, layout.weekStart)

  // Open on today, a quarter of the way in, so what's next has the room.
  const todayScrollLeft = useCallback((): number => {
    const element = scrollRef.current
    return element === null
      ? 0
      : Math.max(0, todayOffset * dayWidth - (element.clientWidth - TITLE_WIDTH) / 4)
  }, [todayOffset, dayWidth])
  useLayoutEffect(() => {
    if (scrollRef.current !== null) {
      scrollRef.current.scrollLeft = todayScrollLeft()
    }
  }, [todayScrollLeft])

  const scrollByScreen = (direction: -1 | 1): void => {
    const element = scrollRef.current
    element?.scrollBy({
      left: direction * (element.clientWidth - TITLE_WIDTH) * 0.8,
      behavior: 'smooth',
    })
  }

  const spanFor = (bar: TimelineBar): TimelineSpan =>
    drag !== null && drag.path === bar.entry.path
      ? shiftSpan(drag.span, drag.edge, drag.delta)
      : (moves.get(bar.entry.path) ?? bar.span)

  const startDrag = useCallback(
    (
      bar: TimelineBar,
      edge: DragEdge,
      span: TimelineSpan,
      event: ReactPointerEvent<HTMLElement>,
    ) => {
      if (event.button !== 0) {
        return
      }
      event.stopPropagation()
      const target = event.currentTarget
      target.setPointerCapture(event.pointerId)
      const originX = event.clientX
      const origin: DragState = { path: bar.entry.path, edge, span, delta: 0 }
      let delta = 0
      // A press only turns into a drag once the pointer travels a few pixels:
      // at month or quarter zoom a day is narrower than a click's jitter.
      let dragging = false
      setDrag(origin)
      const onMove = (moveEvent: PointerEvent): void => {
        const moved = moveEvent.clientX - originX
        if (!dragging && Math.abs(moved) < DRAG_THRESHOLD) {
          return
        }
        dragging = true
        const next = Math.round(moved / dayWidth)
        if (next !== delta) {
          delta = next
          setDrag({ ...origin, delta })
        }
      }
      const onUp = (upEvent: PointerEvent): void => {
        target.removeEventListener('pointermove', onMove)
        target.removeEventListener('pointerup', onUp)
        target.removeEventListener('pointercancel', onUp)
        setDrag(null)
        if (upEvent.type !== 'pointerup') {
          return
        }
        if (!dragging || delta === 0) {
          if (!dragging && edge === 'move') {
            onOpen(bar.entry.path, upEvent)
          }
          return
        }
        const next = shiftSpan(span, edge, delta)
        record(bar.entry.path, next)
        const values: Record<string, string> = {}
        if (edge !== 'end' || fields.end === null) {
          values[fields.start.key] = next.start
        }
        if (edge !== 'start' && fields.end !== null) {
          values[fields.end.key] = next.end
        }
        commitProperties(bar.entry.path, values)
      }
      target.addEventListener('pointermove', onMove)
      target.addEventListener('pointerup', onUp)
      target.addEventListener('pointercancel', onUp)
    },
    [dayWidth, fields, onOpen, record, commitProperties],
  )

  const createToday = async (): Promise<void> => {
    const path = await createNote({
      [fields.start.key]: today,
      ...(fields.end === null ? {} : { [fields.end.key]: today }),
    })
    if (path !== null) {
      onOpen(path)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-none items-center justify-between gap-3 py-2 pl-12 pr-7">
        <div
          role="radiogroup"
          aria-label="Timeline zoom"
          className="flex items-center rounded-md bg-surface-hover p-0.5"
        >
          {TIMELINE_ZOOMS.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={option === zoom}
              onClick={() => onZoomChange(option)}
              className={cn(
                'rounded-[5px] px-2.5 py-0.5 text-xs transition-colors',
                option === zoom
                  ? 'bg-surface font-medium text-text shadow-sm'
                  : 'text-text-secondary hover:text-text',
              )}
            >
              {timelineZoomLabel(option)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Earlier"
            onClick={() => scrollByScreen(-1)}
            className="flex size-6 items-center justify-center rounded-sm text-text-muted hover:text-text-secondary"
          >
            <ChevronLeft aria-hidden className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() =>
              scrollRef.current?.scrollTo({ left: todayScrollLeft(), behavior: 'smooth' })
            }
            className="rounded-sm px-2 py-1 text-xs text-text-secondary hover:bg-surface-hover"
          >
            Today
          </button>
          <button
            type="button"
            aria-label="Later"
            onClick={() => scrollByScreen(1)}
            className="flex size-6 items-center justify-center rounded-sm text-text-muted hover:text-text-secondary"
          >
            <ChevronRight aria-hidden className="size-3.5" />
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        data-collection-timeline
        className={cn('relative min-h-0 flex-1 overflow-auto', drag !== null && 'select-none')}
      >
        <div style={{ width: TITLE_WIDTH + trackWidth }} className="relative min-h-full">
          <div
            style={{ height: HEADER_HEIGHT }}
            className="sticky top-0 z-20 flex border-b border-border bg-surface"
          >
            <div
              style={{ width: TITLE_WIDTH }}
              className="sticky left-0 z-10 flex flex-none items-end bg-surface pb-2 pl-12 text-xs font-medium text-text-muted"
            >
              {`${String(layout.dated)} ${layout.dated === 1 ? 'note' : 'notes'}`}
            </div>
            <TimelineHeader layout={layout} zoom={zoom} labelInset={TITLE_WIDTH} />
          </div>

          <div
            aria-hidden
            style={{
              left: TITLE_WIDTH,
              width: trackWidth,
              top: HEADER_HEIGHT,
              height: items.length * ROW_HEIGHT,
              ...gridStyle,
            }}
            className="pointer-events-none absolute"
          />
          {todayOffset >= 0 && todayOffset < window.days ? (
            <div
              aria-hidden
              style={{ left: TITLE_WIDTH + (todayOffset + 0.5) * dayWidth, top: HEADER_HEIGHT }}
              className="pointer-events-none absolute bottom-0 w-px bg-accent/60"
            />
          ) : null}

          {items.length === 0 ? (
            <p className="py-8 pl-12 pr-7 text-sm text-text-muted">
              No #{tag} notes have a {fields.start.name} yet.
            </p>
          ) : (
            <Virtualizer
              scrollRef={scrollRef}
              startMargin={HEADER_HEIGHT}
              itemSize={ROW_HEIGHT}
              bufferSize={10 * ROW_HEIGHT}
              data={items}
            >
              {(item) =>
                item.kind === 'group' ? (
                  <div
                    key={`group:${item.label}`}
                    role="heading"
                    aria-level={2}
                    style={{ height: ROW_HEIGHT }}
                    className="flex"
                  >
                    <div
                      style={{ width: TITLE_WIDTH }}
                      className="sticky left-0 z-10 flex flex-none select-none items-end gap-2 bg-surface pb-1.5 pl-12"
                    >
                      {item.color === null ? null : (
                        <span
                          aria-hidden
                          className={cn('mb-0.5 size-2 rounded-full', item.color)}
                        />
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
                  <TimelineRow
                    key={item.entry.path}
                    item={item}
                    span={spanFor(item.bar)}
                    windowStart={window.start}
                    dayWidth={dayWidth}
                    trackWidth={trackWidth}
                    dragging={drag?.path === item.entry.path}
                    resizable={fields.end !== null}
                    onOpen={onOpen}
                    onStartDrag={startDrag}
                  />
                )
              }
            </Virtualizer>
          )}
          <div className="sticky left-0 flex w-fit items-center gap-4 py-2 pl-12">
            <button
              type="button"
              onClick={() => void createToday()}
              className="flex items-center gap-1.5 rounded-sm text-[13px] text-text-muted hover:text-text-secondary"
            >
              <Plus aria-hidden className="size-3.5" />
              New
            </button>
            {layout.undated > 0 ? (
              <span className="text-xs text-text-muted">
                {layout.undated === 1 ? '1 note has' : `${String(layout.undated)} notes have`} no{' '}
                {fields.start.name}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Rough width of a bar's title in 12px Inter: enough to choose inside or beside. */
function labelWidth(title: string): number {
  return title.length * 6.6 + 20
}

interface TimelineRowProps {
  item: Extract<TimelineItem, { kind: 'row' }>
  /** The bar's span as drawn (mid-drag or just dropped, else the stored one). */
  span: TimelineSpan
  windowStart: string
  dayWidth: number
  trackWidth: number
  dragging: boolean
  resizable: boolean
  onOpen: (path: string, event?: ModClickEvent) => void
  onStartDrag: (
    bar: TimelineBar,
    edge: DragEdge,
    span: TimelineSpan,
    event: ReactPointerEvent<HTMLElement>,
  ) => void
}

/**
 * One note's line: its title in the frozen column and its bar on the track.
 * Memoized on stable props, so scrolling (which re-renders the virtualizer)
 * repaints only the rows that come into view.
 */
const TimelineRow = memo(function TimelineRow({
  item,
  span,
  windowStart,
  dayWidth,
  trackWidth,
  dragging,
  resizable,
  onOpen,
  onStartDrag,
}: TimelineRowProps): ReactElement {
  const { entry, bar, tone } = item
  const left = daysBetween(windowStart, span.start) * dayWidth
  const width = Math.max(span.days * dayWidth, 12)
  const inside = width >= labelWidth(entry.title)
  return (
    <div data-note-path={entry.path} style={{ height: ROW_HEIGHT }} className="group/row flex">
      <button
        type="button"
        onClick={(event) => onOpen(entry.path, event)}
        style={{ width: TITLE_WIDTH }}
        className="sticky left-0 z-10 flex flex-none items-center bg-surface pl-12 pr-3 text-left text-[13px] text-text-secondary group-hover/row:text-text"
      >
        <span className="truncate">{entry.title}</span>
      </button>
      <div className="relative flex-none" style={{ width: trackWidth }}>
        <div
          role="button"
          tabIndex={-1}
          aria-label={`${entry.title}, ${span.start} to ${span.end}`}
          onPointerDown={(event) => onStartDrag(bar, 'move', span, event)}
          style={{ left, width }}
          className={cn(
            'absolute top-1.5 z-[1] flex h-6 cursor-grab items-center rounded-md text-xs font-medium transition-shadow active:cursor-grabbing',
            tone,
            dragging ? 'shadow-md' : 'hover:shadow-sm',
          )}
        >
          {resizable ? (
            <span
              aria-hidden
              onPointerDown={(event) => onStartDrag(bar, 'start', span, event)}
              className="absolute inset-y-0 -left-0.5 w-2.5 cursor-ew-resize"
            />
          ) : null}
          {inside ? (
            <span style={{ left: TITLE_WIDTH }} className="sticky min-w-0 truncate px-2.5">
              {entry.title}
            </span>
          ) : null}
          {resizable ? (
            <span
              aria-hidden
              onPointerDown={(event) => onStartDrag(bar, 'end', span, event)}
              className="absolute inset-y-0 -right-0.5 w-2.5 cursor-ew-resize"
            />
          ) : null}
        </div>
        {inside ? null : (
          <span
            style={{ left: left + width + 8 }}
            className="pointer-events-none absolute top-1.5 flex h-6 items-center whitespace-nowrap text-xs text-text-secondary"
          >
            {entry.title}
          </span>
        )}
      </div>
    </div>
  )
})
