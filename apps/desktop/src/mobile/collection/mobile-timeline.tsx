import { useCallback, useEffect, useLayoutEffect, useRef, type ReactElement } from 'react'
import { Virtualizer } from 'virtua'
import {
  TIMELINE_ZOOMS,
  type CollectionEntry,
  type TagProperty,
  type TimelineZoom,
} from '@kore/core'
import { timelineZoomLabel } from '@/components/all-notes/collection-view-model'
import { TimelineHeader, timelineGridStyle } from '@/components/all-notes/timeline-header'
import { daysBetween, type TimelineFields } from '@/lib/tags/timeline-layout'
import { useTimelineLayout } from '@/lib/tags/use-timeline-layout'
import { ChevronLeft, ChevronRight } from '@/components/icons'
import { cn } from '@/lib/utils'
import { hapticImpactLight } from '@/mobile/haptics'

const ROW_HEIGHT = 44
const GROUP_HEIGHT = 40
const HEADER_HEIGHT = 48
/** The page's side gutter: group labels and the first bar line up with it. */
const GUTTER = 16

interface MobileTimelineProps {
  /** The rows the view shows (its filters and search already applied). */
  entries: readonly CollectionEntry[]
  fields: TimelineFields
  groupProperty: TagProperty | null
  zoom: TimelineZoom
  onZoomChange: (zoom: TimelineZoom) => void
  onOpen: (path: string) => void
}

/**
 * A type's timeline on a phone: the Mac's bars on the same days and in the
 * same colors, without the title column (the title rides in or beside its
 * bar) so the track gets the whole width. The track scrolls both ways; a
 * tap opens the note. Dates change in the note itself: dragging a bar
 * would fight the page's own scroll.
 */
export function MobileTimeline({
  entries,
  fields,
  groupProperty,
  zoom,
  onZoomChange,
  onOpen,
}: MobileTimelineProps): ReactElement {
  const layout = useTimelineLayout(entries, fields, groupProperty, zoom)
  const { items, window, todayOffset, dayWidth } = layout
  const scrollRef = useRef<HTMLDivElement>(null)
  const trackWidth = window.days * dayWidth
  const gridStyle = timelineGridStyle(dayWidth, zoom, layout.weekStart)
  const itemsHeight = items.reduce(
    (total, item) => total + (item.kind === 'group' ? GROUP_HEIGHT : ROW_HEIGHT),
    0,
  )

  const todayScrollLeft = useCallback((): number => {
    const element = scrollRef.current
    return element === null ? 0 : Math.max(0, todayOffset * dayWidth - element.clientWidth / 4)
  }, [todayOffset, dayWidth])
  useLayoutEffect(() => {
    if (scrollRef.current !== null) {
      scrollRef.current.scrollLeft = todayScrollLeft()
    }
  }, [todayScrollLeft])

  // The visible stretch of the track, as CSS numbers the off-screen hints
  // read (see EdgeHint): a scroll writes two custom properties and never
  // re-renders a row.
  useEffect(() => {
    const element = scrollRef.current
    if (element === null) {
      return
    }
    const sync = (): void => {
      element.style.setProperty('--timeline-left', String(element.scrollLeft))
      element.style.setProperty(
        '--timeline-right',
        String(element.scrollLeft + element.clientWidth),
      )
    }
    sync()
    element.addEventListener('scroll', sync, { passive: true })
    const observer = new ResizeObserver(sync)
    observer.observe(element)
    return () => {
      element.removeEventListener('scroll', sync)
      observer.disconnect()
    }
  }, [])

  const scrollToBar = (left: number): void => {
    hapticImpactLight()
    scrollRef.current?.scrollTo({ left: Math.max(0, left - GUTTER * 2), behavior: 'smooth' })
  }

  const pickZoom = (next: TimelineZoom): void => {
    hapticImpactLight()
    onZoomChange(next)
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      style={{ paddingTop: 'var(--mobile-header-height, 0px)' }}
    >
      <div className="flex h-14 flex-none items-center gap-2 px-4">
        <div
          role="radiogroup"
          aria-label="Timeline zoom"
          className="flex items-center rounded-full bg-surface-hover p-0.5"
        >
          {TIMELINE_ZOOMS.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={option === zoom}
              onClick={() => pickZoom(option)}
              className={cn(
                "relative h-8 rounded-full px-3.5 text-[13px] transition-colors before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']",
                option === zoom
                  ? 'bg-surface font-semibold text-text shadow-sm'
                  : 'font-medium text-text-muted',
              )}
            >
              {timelineZoomLabel(option)}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => {
            hapticImpactLight()
            scrollRef.current?.scrollTo({ left: todayScrollLeft(), behavior: 'smooth' })
          }}
          className="h-8 rounded-full bg-surface-hover px-3.5 text-[13px] font-medium text-text active:opacity-60"
        >
          Today
        </button>
      </div>

      <div
        ref={scrollRef}
        data-base-ui-swipe-ignore
        data-collection-timeline
        className="relative min-h-0 flex-1 overflow-auto overscroll-contain"
        style={{
          paddingBottom: 'var(--mobile-tab-bar-height, env(safe-area-inset-bottom))',
        }}
      >
        <div style={{ width: trackWidth }} className="relative min-h-full">
          <div
            style={{ height: HEADER_HEIGHT }}
            className="sticky top-0 z-20 flex border-b border-border bg-background"
          >
            <TimelineHeader layout={layout} zoom={zoom} labelInset={GUTTER - 8} />
          </div>
          <div
            aria-hidden
            style={{ top: HEADER_HEIGHT, height: itemsHeight, ...gridStyle }}
            className="pointer-events-none absolute inset-x-0"
          />
          {todayOffset >= 0 && todayOffset < window.days ? (
            <div
              aria-hidden
              style={{ left: (todayOffset + 0.5) * dayWidth, top: HEADER_HEIGHT }}
              className="pointer-events-none absolute bottom-0 w-px bg-accent/60"
            />
          ) : null}
          {items.length === 0 ? (
            <p style={{ left: GUTTER }} className="sticky w-fit py-8 text-[15px] text-text-muted">
              No notes have a {fields.start.name} yet.
            </p>
          ) : (
            <Virtualizer
              as="ul"
              item="li"
              scrollRef={scrollRef}
              startMargin={HEADER_HEIGHT}
              itemSize={ROW_HEIGHT}
              bufferSize={8 * ROW_HEIGHT}
              data={items}
            >
              {(item) =>
                item.kind === 'group' ? (
                  <div
                    key={`group:${item.label}`}
                    role="heading"
                    aria-level={2}
                    style={{ height: GROUP_HEIGHT }}
                    className="flex items-end pb-1.5"
                  >
                    <span
                      style={{ left: GUTTER }}
                      className="sticky flex items-center gap-1.5 rounded-full bg-surface-hover py-1 pr-2.5 pl-2"
                    >
                      {item.color === null ? null : (
                        <span aria-hidden className={cn('size-2 rounded-full', item.color)} />
                      )}
                      <span className="text-[13px] font-semibold leading-none text-text">
                        {item.label}
                      </span>
                      <span className="text-[13px] leading-none tabular-nums text-text-muted">
                        {item.count}
                      </span>
                    </span>
                  </div>
                ) : (
                  <MobileTimelineRow
                    key={item.entry.path}
                    title={item.entry.title}
                    left={daysBetween(window.start, item.bar.span.start) * dayWidth}
                    width={Math.max(item.bar.span.days * dayWidth, 14)}
                    tone={item.tone}
                    label={`${item.entry.title}, ${item.bar.span.start} to ${item.bar.span.end}`}
                    onOpen={() => onOpen(item.entry.path)}
                    onReveal={scrollToBar}
                  />
                )
              }
            </Virtualizer>
          )}
          {layout.undated > 0 ? (
            <p style={{ left: GUTTER }} className="sticky w-fit py-4 text-[13px] text-text-muted">
              {layout.undated === 1 ? '1 note has' : `${String(layout.undated)} notes have`} no{' '}
              {fields.start.name}, so {layout.undated === 1 ? 'it shows' : 'they show'} in the
              table.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

interface MobileTimelineRowProps {
  title: string
  left: number
  width: number
  tone: string
  label: string
  onOpen: () => void
  /** Scroll the track so the bar starting at `left` comes into view. */
  onReveal: (left: number) => void
}

/** Rough width of a title in 13px Inter, to choose inside or beside the bar. */
function labelWidth(title: string): number {
  return title.length * 7.4 + 24
}

/**
 * One note's line: its bar, and two hints pinned to the screen's edges that
 * fade in only while the bar is scrolled out of view on that side, so a
 * row never reads as empty. Their opacity is computed by CSS from the
 * track's visible stretch, so scrolling repaints them without React.
 */
function MobileTimelineRow({
  title,
  left,
  width,
  tone,
  label,
  onOpen,
  onReveal,
}: MobileTimelineRowProps): ReactElement {
  const inside = width >= labelWidth(title)
  // The bar's visible extent includes an outside title, so the hint never
  // doubles a label that is already on screen.
  const end = left + (inside ? width : width + 8 + labelWidth(title))
  return (
    <div style={{ height: ROW_HEIGHT }} className="relative">
      <EdgeHint
        side="left"
        title={title}
        opacity={`clamp(0, calc((var(--timeline-left, 0) - ${String(end)}) / 24), 1)`}
        onReveal={() => onReveal(left)}
      />
      <EdgeHint
        side="right"
        title={title}
        opacity={`clamp(0, calc((${String(left)} - var(--timeline-right, 1e9)) / 24), 1)`}
        onReveal={() => onReveal(left)}
      />
      <button
        type="button"
        aria-label={label}
        onClick={() => {
          hapticImpactLight()
          onOpen()
        }}
        style={{ left }}
        className="absolute inset-y-0 z-10 flex items-center gap-2 active:opacity-60"
      >
        <span
          style={{ width }}
          className={cn('flex h-8 shrink-0 items-center rounded-lg text-[13px] font-medium', tone)}
        >
          {inside ? (
            <span style={{ left: GUTTER }} className="sticky min-w-0 truncate px-3">
              {title}
            </span>
          ) : null}
        </span>
        {inside ? null : (
          <span className="whitespace-nowrap pr-4 text-[13px] text-text-secondary">{title}</span>
        )}
      </button>
    </div>
  )
}

interface EdgeHintProps {
  side: 'left' | 'right'
  title: string
  /** A CSS opacity expression over the track's visible stretch. */
  opacity: string
  onReveal: () => void
}

function EdgeHint({ side, title, opacity, onReveal }: EdgeHintProps): ReactElement {
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 flex items-center',
        side === 'right' && 'justify-end',
      )}
    >
      <button
        type="button"
        tabIndex={-1}
        onClick={onReveal}
        style={{ opacity, [side]: GUTTER }}
        className="pointer-events-auto sticky flex h-8 max-w-[60%] items-center gap-1 rounded-full bg-surface-hover px-2.5 text-[13px] text-text-secondary transition-opacity duration-150"
      >
        {side === 'left' ? <ChevronLeft aria-hidden className="size-3.5 shrink-0" /> : null}
        <span className="truncate">{title}</span>
        {side === 'right' ? <ChevronRight aria-hidden className="size-3.5 shrink-0" /> : null}
      </button>
    </div>
  )
}
