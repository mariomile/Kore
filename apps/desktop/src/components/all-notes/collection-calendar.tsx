import { useMemo, useState, type ReactElement } from 'react'
import {
  isCalendarDate,
  weekStartDow,
  type CollectionEntry,
  type TagProperty,
  type TagType,
} from '@reflect/core'
import { ChevronLeft, ChevronRight } from '@/components/icons'
import type { ModClickEvent } from '@/lib/windows/open-in-new-window'
import { cn } from '@/lib/utils'
import { useSettings } from '@/providers/settings-provider'
import { readCellValue } from './collection-cell'

/**
 * The Collection's calendar (TDR 0005): a month grid with each row placed on
 * the day its date property holds. Read-and-navigate in V1 — click a note to
 * open it, page months with the header arrows; a note whose value isn't a
 * calendar date simply doesn't appear (the table still shows it raw).
 */

/** The property the calendar places by: the schema's first `date`. */
export function calendarProperty(type: TagType): TagProperty | null {
  return type.properties.find((property) => property.type === 'date') ?? null
}

/** Local `YYYY-MM-DD` for a Date (the daily-note key space). */
function toIso(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** Entries grouped by their calendar-date value under `property`. */
export function entriesByDate(
  entries: readonly CollectionEntry[],
  property: TagProperty,
): Map<string, CollectionEntry[]> {
  const byDate = new Map<string, CollectionEntry[]>()
  for (const entry of entries) {
    const reading = readCellValue(property, entry.properties[property.key])
    if (reading.mismatch || !isCalendarDate(reading.text)) {
      continue
    }
    byDate.set(reading.text, [...(byDate.get(reading.text) ?? []), entry])
  }
  return byDate
}

interface MonthCell {
  iso: string
  day: number
  inMonth: boolean
}

/** Six weeks of cells covering `year`/`month`, aligned to the week start. */
export function monthGrid(year: number, month: number, weekStart: 0 | 1 | 6): MonthCell[] {
  const lead = (new Date(year, month, 1).getDay() - weekStart + 7) % 7
  const cells: MonthCell[] = []
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(year, month, 1 - lead + index)
    cells.push({ iso: toIso(date), day: date.getDate(), inMonth: date.getMonth() === month })
  }
  return cells
}

const MAX_NOTES_PER_DAY = 3

interface CollectionCalendarProps {
  entries: readonly CollectionEntry[] | undefined
  /** The placing date property — the screen only renders the calendar when
   * {@link calendarProperty} found one. */
  property: TagProperty
  onOpen: (path: string, event?: ModClickEvent) => void
}

export function CollectionCalendar({
  entries,
  property,
  onOpen,
}: CollectionCalendarProps): ReactElement {
  const weekStartDay = useSettings().settings.weekStartDay
  const weekStart = weekStartDow(weekStartDay)
  // "Today" freezes at mount — good enough for a view that rarely straddles
  // midnight, and it keeps the render pure.
  const [now] = useState(() => new Date())
  const [visible, setVisible] = useState(() => ({
    year: now.getFullYear(),
    month: now.getMonth(),
  }))
  const todayIso = toIso(now)

  const byDate = useMemo(() => entriesByDate(entries ?? [], property), [entries, property])
  const cells = useMemo(
    () => monthGrid(visible.year, visible.month, weekStart),
    [visible, weekStart],
  )
  const weekdayLabels = useMemo(() => {
    // Any week works as a label source; Jan 2024 starts on a Monday.
    return Array.from({ length: 7 }, (_, index) =>
      new Date(2024, 0, 1 + ((weekStart + 6) % 7) + index).toLocaleDateString(undefined, {
        weekday: 'short',
      }),
    )
  }, [weekStart])
  const monthLabel = new Date(visible.year, visible.month).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })

  const shift = (delta: number): void => {
    const date = new Date(visible.year, visible.month + delta)
    setVisible({ year: date.getFullYear(), month: date.getMonth() })
  }

  return (
    <div className="flex h-full flex-col px-12 pb-6">
      <div className="flex flex-none items-center justify-between py-2">
        <h2 className="text-sm font-medium text-text">{monthLabel}</h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => shift(-1)}
            className="flex size-6 items-center justify-center rounded text-text-muted hover:text-text-secondary"
          >
            <ChevronLeft aria-hidden className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Today"
            onClick={() => setVisible({ year: now.getFullYear(), month: now.getMonth() })}
            className="rounded px-2 py-1 text-xs text-text-secondary hover:bg-surface-hover"
          >
            Today
          </button>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => shift(1)}
            className="flex size-6 items-center justify-center rounded text-text-muted hover:text-text-secondary"
          >
            <ChevronRight aria-hidden className="size-3.5" />
          </button>
        </div>
      </div>
      <div className="grid flex-none grid-cols-7 border-b border-border pb-1">
        {weekdayLabels.map((label) => (
          <span key={label} className="px-1.5 text-xs font-medium text-text-muted">
            {label}
          </span>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-7 overflow-y-auto">
        {cells.map((cell) => {
          const dayEntries = byDate.get(cell.iso) ?? []
          return (
            <div
              key={cell.iso}
              className={cn(
                'flex min-h-20 flex-col gap-0.5 border-b border-r border-border/60 p-1.5',
                !cell.inMonth && 'opacity-40',
              )}
            >
              <span
                className={cn(
                  'text-xs tabular-nums',
                  cell.iso === todayIso ? 'font-semibold text-accent' : 'text-text-muted',
                )}
              >
                {cell.day}
              </span>
              {dayEntries.slice(0, MAX_NOTES_PER_DAY).map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  data-note-path={entry.path}
                  onClick={(event) => onOpen(entry.path, event)}
                  className="truncate rounded bg-surface-hover px-1.5 py-0.5 text-left text-xs text-text-secondary hover:text-text"
                >
                  {entry.title}
                </button>
              ))}
              {dayEntries.length > MAX_NOTES_PER_DAY ? (
                <span className="px-1.5 text-[11px] text-text-muted">
                  +{dayEntries.length - MAX_NOTES_PER_DAY} more
                </span>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
