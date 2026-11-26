import { useState, type ReactElement } from 'react'
import { ChevronLeft, ChevronRight } from '@/components/icons'
import { weekStartDow } from '@kore/core'
import { formatDayLabel } from '@/lib/dates'
import { addMonths, buildMonthGrid, monthLabel, monthOf, weekdayLabels } from '@/lib/month-grid'
import { cn } from '@/lib/utils'
import { useSettings } from '@/providers/settings-provider'

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
        <nav className="flex items-center gap-1 text-text-muted">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => setMonth(addMonths(month, -1))}
            className="rounded-md p-2"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => setMonth(addMonths(month, 1))}
            className="rounded-md p-2"
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
        <div key={week[0]?.date ?? weekIndex} className="grid grid-cols-7 text-center">
          {week.map((cell) => {
            const isToday = cell.date === today
            const isSelected = cell.date === selected
            return (
              <button
                key={cell.date}
                type="button"
                aria-label={formatDayLabel(cell.date, settings.dateFormat)}
                aria-current={isToday ? 'date' : undefined}
                aria-pressed={isSelected}
                onClick={() => onPick(cell.date)}
                className={cn(
                  'mx-auto my-0.5 size-9 rounded-md text-sm tabular-nums',
                  !cell.inMonth && !isToday && !isSelected && 'text-text-muted/40',
                  isToday && 'font-bold text-accent',
                  isSelected && 'bg-accent-soft ring-1 ring-inset ring-accent/30',
                )}
              >
                {Number(cell.date.slice(8, 10))}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
