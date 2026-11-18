import type { ReactElement } from 'react'
import { isoWeekOf, weeklyNoteTitle, weeklyPath } from '@kore/core'
import { Calendar, ChevronRight } from '@/components/icons'
import { useNoteRowState } from '@/hooks/use-note-row'
import { useOpenWeek } from '@/hooks/use-open-week'
import { formatWeekRange } from '@/lib/dates'
import { cn } from '@/lib/utils'

/**
 * `Week 47 · Nov 16 – 22, 2026 ›` over Monday's subject in the daily stream:
 * the stream's only week marker. Eyebrow-sized and muted so the date below
 * stays the row's subject.
 */
export function WeekEyebrow({
  date,
  className,
}: {
  date: string
  className?: string
}): ReactElement {
  const openWeek = useOpenWeek()
  const week = isoWeekOf(date)
  return (
    <div className={className}>
      <button
        type="button"
        title={`Open week ${week.week}`}
        onClick={(event) => openWeek(week, event)}
        className="group/week -mx-1.5 inline-flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium text-text-muted transition-colors duration-150 ease-swift hover:bg-surface-hover hover:text-text"
      >
        <span className="text-text-secondary group-hover/week:text-text">
          {weeklyNoteTitle(week)}
        </span>
        <span aria-hidden>·</span>
        <span>{formatWeekRange(week)}</span>
        <ChevronRight aria-hidden className="size-3 opacity-60" />
      </button>
    </div>
  )
}

/**
 * The day's week in the daily Details panel, right under the calendar: the
 * week's note one click away from any day. Says when the week has no note
 * yet; opening it there starts one on the first keystroke.
 */
export function WeekCard({ date, className }: { date: string; className?: string }): ReactElement {
  const openWeek = useOpenWeek()
  const week = isoWeekOf(date)
  const { row, settled } = useNoteRowState(weeklyPath(week))
  const missing = settled && row === null
  return (
    <div className={cn('px-4', className)}>
      <button
        type="button"
        title={`Open week ${week.week}`}
        onClick={(event) => openWeek(week, event)}
        className="flex w-full cursor-default items-center gap-3 rounded-xl bg-surface-hover/60 px-3 py-2.5 text-left transition-colors duration-150 ease-swift hover:bg-surface-hover active:bg-surface-active"
      >
        <Calendar aria-hidden className="size-4 shrink-0 text-text-muted" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-text">{weeklyNoteTitle(week)}</span>
          <span className="block truncate text-xs text-text-muted">
            {formatWeekRange(week)}
            {missing ? ' · Not started' : ''}
          </span>
        </span>
        <ChevronRight aria-hidden className="size-3.5 shrink-0 text-text-muted" />
      </button>
    </div>
  )
}
