import { useMemo, useState } from 'react'
import { weekStartDow, type CollectionEntry, type TagProperty, type TimelineZoom } from '@kore/core'
import { tableGroupRows } from '@/components/all-notes/collection-board'
import { selectOptionBadgeClass } from '@/components/tags/select-colors'
import { todayIso } from '@/lib/dates'
import { useSettings } from '@/providers/settings-provider'
import {
  daysBetween,
  placeBars,
  TIMELINE_DAY_WIDTH,
  timelineBarsOf,
  timelineMonthsOf,
  timelineTicksOf,
  timelineWindowOf,
  type TimelineBar,
  type TimelineFields,
  type TimelineMonth,
  type TimelineTick,
  type TimelineWindow,
} from './timeline-layout'

/** One line of a timeline: a group's header, or a note's bar. */
export type TimelineItem =
  | {
      readonly kind: 'group'
      readonly label: string
      /** The group's dot class, `null` for the neutral "No …" group. */
      readonly color: string | null
      readonly count: number
    }
  | {
      readonly kind: 'row'
      readonly entry: CollectionEntry
      readonly bar: TimelineBar
      /** The bar's wash + text classes (its group's option color). */
      readonly tone: string
    }

export interface TimelineLayout {
  readonly items: readonly TimelineItem[]
  readonly window: TimelineWindow
  readonly months: readonly TimelineMonth[]
  readonly ticks: readonly TimelineTick[]
  readonly today: string
  /** Today's day index in the window. */
  readonly todayOffset: number
  readonly dayWidth: number
  /** Notes with a bar. */
  readonly dated: number
  /** Notes with neither date, left off the timeline. */
  readonly undated: number
  readonly weekStart: number
}

/** The bar color when the rows aren't grouped by a colored option. */
export const NEUTRAL_TIMELINE_TONE = 'bg-accent-soft text-accent-soft-text'

/**
 * Everything a timeline draws, shared by the Mac and the iPhone so a note's
 * bar covers the same days, in the same group and color, on both.
 */
export function useTimelineLayout(
  entries: readonly CollectionEntry[] | undefined,
  fields: TimelineFields,
  groupProperty: TagProperty | null,
  zoom: TimelineZoom,
): TimelineLayout {
  const weekStart = weekStartDow(useSettings().settings.weekStartDay)
  const [today] = useState(() => todayIso())
  const { bars, undated, spans } = useMemo(
    () => timelineBarsOf(entries ?? [], fields),
    [entries, fields],
  )
  const window = useMemo(
    () => timelineWindowOf(spans, today, zoom, weekStart),
    [spans, today, zoom, weekStart],
  )
  const months = useMemo(() => timelineMonthsOf(window), [window])
  const ticks = useMemo(() => timelineTicksOf(window, zoom), [window, zoom])
  const items = useMemo((): TimelineItem[] => {
    const placed = new Map(placeBars(bars, window).map((bar) => [bar.entry.path, bar]))
    const datedEntries = bars.map((bar) => bar.entry)
    const rowsOf = (list: readonly CollectionEntry[], tone: string): TimelineItem[] =>
      list.flatMap((entry) => {
        const bar = placed.get(entry.path)
        return bar === undefined ? [] : [{ kind: 'row' as const, entry, bar, tone }]
      })
    if (groupProperty === null) {
      return rowsOf(datedEntries, NEUTRAL_TIMELINE_TONE)
    }
    const colored = groupProperty.type === 'select' || groupProperty.type === 'status'
    const list: TimelineItem[] = []
    for (const group of tableGroupRows(datedEntries, groupProperty)) {
      if (group.entries.length === 0) {
        continue
      }
      const tone =
        colored && group.color !== null
          ? selectOptionBadgeClass(group.label, groupProperty)
          : NEUTRAL_TIMELINE_TONE
      list.push({
        kind: 'group',
        label: group.label,
        color: group.color,
        count: group.entries.length,
      })
      list.push(...rowsOf(group.entries, tone))
    }
    return list
  }, [bars, window, groupProperty])

  return {
    items,
    window,
    months,
    ticks,
    today,
    todayOffset: daysBetween(window.start, today),
    dayWidth: TIMELINE_DAY_WIDTH[zoom],
    dated: bars.length,
    undated,
    weekStart,
  }
}
