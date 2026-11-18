import type { CSSProperties, ReactElement } from 'react'
import type { TimelineZoom } from '@kore/core'
import type { TimelineLayout } from '@/lib/tags/use-timeline-layout'
import { cn } from '@/lib/utils'

/** How close (px) a tick may sit to today's marker before it hides behind it. */
const TODAY_CLEARANCE = 22

interface TimelineHeaderProps {
  layout: TimelineLayout
  zoom: TimelineZoom
  /** Left edge the month labels stick to (the Mac's title column). */
  labelInset: number
  className?: string
}

/**
 * A timeline's day axis: month bands whose names stay in view while the
 * track scrolls, ticks under them, and today's date as an accent pill.
 * Shared by the Mac and the iPhone timelines.
 */
export function TimelineHeader({
  layout,
  zoom,
  labelInset,
  className,
}: TimelineHeaderProps): ReactElement {
  const { months, ticks, window, today, todayOffset, dayWidth } = layout
  const showToday = todayOffset >= 0 && todayOffset < window.days
  const todayX = (todayOffset + 0.5) * dayWidth
  return (
    <div className={cn('relative flex-none', className)} style={{ width: window.days * dayWidth }}>
      {months.map((month) => (
        <div
          key={month.key}
          style={{ left: month.offset * dayWidth, width: month.days * dayWidth }}
          className="absolute top-0 h-6 border-l border-border"
        >
          <span
            style={{ left: labelInset }}
            className="sticky inline-block max-w-full truncate px-2 pt-1.5 text-xs font-semibold text-text"
          >
            {month.label}
          </span>
        </div>
      ))}
      {ticks.map((tick) => {
        const x = zoom === 'week' ? (tick.offset + 0.5) * dayWidth : tick.offset * dayWidth + 8
        if (showToday && Math.abs(x - todayX) < TODAY_CLEARANCE) {
          return null
        }
        return (
          <span
            key={tick.day}
            style={{ left: tick.offset * dayWidth, width: zoom === 'week' ? dayWidth : undefined }}
            className={cn(
              'absolute bottom-1.5 flex items-baseline gap-0.5 text-[11px] tabular-nums',
              zoom === 'week' ? 'justify-center' : 'pl-1.5',
              tick.weekend && zoom === 'week' ? 'text-text-muted/60' : 'text-text-muted',
            )}
          >
            {tick.weekday === null ? null : <span>{tick.weekday}</span>}
            <span>{tick.label}</span>
          </span>
        )
      })}
      {showToday ? (
        <span
          aria-label={`Today, ${today}`}
          style={{ left: todayX }}
          className="absolute bottom-1 z-10 -translate-x-1/2 rounded-full bg-accent px-1.5 py-px text-[11px] font-semibold tabular-nums text-text-on-brand"
        >
          {Number(today.slice(8, 10))}
        </span>
      ) : null}
    </div>
  )
}

/**
 * The track's background: a hairline every week (and, zoomed to a week, a
 * wash on weekends) painted as one gradient, not a node per day, so a long
 * track stays a handful of elements. The window opens on a week start, so
 * Saturday always sits at the same column.
 */
export function timelineGridStyle(
  dayWidth: number,
  zoom: TimelineZoom,
  weekStart: number,
): CSSProperties {
  const week = 7 * dayWidth
  const saturday = (6 - weekStart + 7) % 7
  const layers = [
    `repeating-linear-gradient(to right, var(--border) 0 1px, transparent 1px ${String(week)}px)`,
  ]
  if (zoom === 'week') {
    layers.push(
      `repeating-linear-gradient(to right, var(--surface-sunken) 0 ${String(2 * dayWidth)}px, transparent ${String(2 * dayWidth)}px ${String(week)}px)`,
    )
  }
  return {
    backgroundImage: layers.join(','),
    backgroundPositionX: `0px, ${String(saturday * dayWidth)}px`,
  }
}
