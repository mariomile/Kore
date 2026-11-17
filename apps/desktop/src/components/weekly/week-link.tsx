import type { ReactElement } from 'react'
import { isoWeekOf, weeklyPath } from '@kore/core'
import { ChevronRight } from '@/components/icons'
import { formatWeekRange } from '@/components/weekly/week-header'
import { useNoteLinkNavigation } from '@/hooks/use-note-link-navigation'
import { parseIsoDate } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { isModEvent } from '@meowdown/core'

/** Monday, the first day of an ISO week (the weekly note's first day). */
export function isWeekStart(date: string): boolean {
  return parseIsoDate(date).getDay() === 1
}

/**
 * `Week 47 · Nov 16 – 22, 2026 ›` over Monday's subject in the daily stream:
 * opens that week's note (⌘-click beside this one). Eyebrow-sized and muted
 * so the date below stays the row's subject.
 */
export function WeekLink({ date, className }: { date: string; className?: string }): ReactElement {
  const navigateNoteLink = useNoteLinkNavigation()
  const week = isoWeekOf(date)
  return (
    <div className={className}>
      <button
        type="button"
        title={`Open week ${week.week}`}
        onClick={(event) => {
          navigateNoteLink({
            target: { kind: 'note', path: weeklyPath(week) },
            openInSplit: isModEvent(event),
          })
        }}
        className={cn(
          'group/week -mx-1.5 inline-flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium text-text-muted',
          'transition-colors duration-150 ease-swift hover:bg-surface-hover hover:text-text',
        )}
      >
        <span className="text-text-secondary group-hover/week:text-text">Week {week.week}</span>
        <span aria-hidden>·</span>
        <span>{formatWeekRange(week)}</span>
        <ChevronRight aria-hidden className="size-3 opacity-60" />
      </button>
    </div>
  )
}
