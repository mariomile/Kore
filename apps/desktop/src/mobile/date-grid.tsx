import { useState, type ReactElement } from 'react'
import { ChevronLeft, ChevronRight } from '@/components/icons'
import { weekStartDow } from '@kore/core'
import { formatDayLabel } from '@/lib/dates'
import { addMonths, buildMonthGrid, monthLabel, monthOf, weekdayLabels } from '@/lib/month-grid'
import { cn } from '@/lib/utils'
import { useSettings } from '@/providers/settings-provider'

/** The most weeks any month spans in a grid. */
const MAX_WEEKS = 6

interface DateGridProps {
  /** Today's live ISO date — anchors the opening month and marks "today". */
  today: string
  /** The current date, shown selected in the grid. */
  selected: string | null
  /** Pick a day (an ISO `YYYY-MM-DD`). */
  onPick: (isoDate: string) => void
}

/**
 * Kore's touch month grid, rendered inline inside a bottom sheet (the task
 * quick-edit sheet, the date property sheet): tapping a day picks it. Inline
 * rather than a popover or a native `<input type="date">`, because either one
 * stacks a second calendar over the sheet on a phone screen. Reuses
 * {@link buildMonthGrid}, so it shares the daily calendar's math.
 */
export function DateGrid({ today, selected, onPick }: DateGridProps): ReactElement {
  const { settings } = useSettings()
  const weekStartsOn = weekStartDow(settings.weekStartDay)
  // Open on the selected date's month when there is one, else today's.
  const [month, setMonth] = useState(() => monthOf(selected ?? today))
  const grid = buildMonthGrid(month, weekStartsOn)

  return (
    <div aria-label="Pick a date">
      <header className="flex items-center justify-between px-1 pb-1">
        <div className="text-sm font-semibold text-text">{monthLabel(month)}</div>
        <nav className="-mr-2 flex items-center text-text-muted">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => setMonth(addMonths(month, -1))}
            className="flex size-11 items-center justify-center rounded-full active:bg-surface-hover"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => setMonth(addMonths(month, 1))}
            className="flex size-11 items-center justify-center rounded-full active:bg-surface-hover"
          >
            <ChevronRight className="size-4" />
          </button>
        </nav>
      </header>
      <div className="grid grid-cols-7 text-center">
        {weekdayLabels(weekStartsOn).map((weekday) => (
          <div key={weekday} className="py-1 text-xs font-medium text-text-muted">
            {weekday}
          </div>
        ))}
      </div>
      {grid.weeks.map((week, weekIndex) => (
        // buildMonthGrid always fills weeks with 7 cells; the index fallback
        // only documents that invariant without asserting past the types.
        <div key={week[0]?.date ?? weekIndex} className="grid grid-cols-7">
          {week.map((cell) => {
            const isToday = cell.date === today
            const isSelected = cell.date === selected
            return (
              // The whole 44pt cell is the touch target; the circle inside is
              // the daily week strip's selection shape.
              <button
                key={cell.date}
                type="button"
                aria-label={formatDayLabel(cell.date, settings.dateFormat)}
                aria-current={isToday ? 'date' : undefined}
                aria-pressed={isSelected}
                onClick={() => onPick(cell.date)}
                className="group flex h-11 items-center justify-center"
              >
                <span
                  className={cn(
                    'flex size-9 items-center justify-center rounded-full text-sm tabular-nums transition-colors duration-150 motion-reduce:transition-none',
                    isSelected
                      ? 'bg-primary font-semibold text-primary-foreground'
                      : 'group-active:bg-surface-hover',
                    !isSelected && isToday && 'font-semibold text-primary',
                    !isSelected && !isToday && (cell.inMonth ? 'text-text' : 'text-text-muted/40'),
                  )}
                >
                  {Number(cell.date.slice(8, 10))}
                </span>
              </button>
            )
          })}
        </div>
      ))}
      {/* Pad 5-week months to six rows so the sheet keeps its height while paging. */}
      {Array.from({ length: MAX_WEEKS - grid.weeks.length }, (_, index) => (
        <div key={`pad-${index}`} aria-hidden className="h-11" />
      ))}
    </div>
  )
}
