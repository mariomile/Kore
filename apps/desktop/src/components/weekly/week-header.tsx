import type { ReactElement } from 'react'
import { format } from 'date-fns'
import { addWeeks, daysOfWeek, isoWeekOf, weeklyNoteTitle, type IsoWeek } from '@kore/core'
import { PeriodPill } from '@/components/period-pill'
import { useDailyNoteDates } from '@/hooks/use-daily-note-dates'
import { useNoteLinkNavigation } from '@/hooks/use-note-link-navigation'
import { formatWeekRange, parseIsoDate } from '@/lib/dates'
import { useToday } from '@/lib/use-today'
import { cn } from '@/lib/utils'
import { weeklyRoute } from '@/routing/route'
import { useRouter } from '@/routing/router'
import { isModEvent } from '@meowdown/core'

interface WeekHeaderProps {
  week: IsoWeek
  className?: string
}

/**
 * The subject of a weekly note, in the daily subject's grammar: `Week 47`
 * display-sized over its date range, the same ‹ period › pill the daily
 * stream floats, then the week's seven days. A day opens its daily note
 * (⌘-click beside this one); a dot marks days that have one, today is
 * tinted brand. The days are derived from the week, never written into the
 * file, so the Markdown stays the user's own.
 */
export function WeekHeader({ week, className }: WeekHeaderProps): ReactElement {
  const { navigate } = useRouter()
  const today = useToday()
  const thisWeek = isoWeekOf(today)

  return (
    <header aria-label={weeklyNoteTitle(week)} className={cn('mb-1', className)}>
      <div className="flex items-start justify-between gap-3 border-b border-border pb-4">
        <div className="min-w-0">
          <h1 className="kore-daily-subject">{weeklyNoteTitle(week)}</h1>
          <p className="mt-1 text-sm text-text-muted">{formatWeekRange(week)}</p>
        </div>
        <PeriodPill
          className="mt-1 shrink-0"
          label="This week"
          labelTitle="Jump to this week"
          labelDisabled={thisWeek.key === week.key}
          onLabel={() => navigate(weeklyRoute(thisWeek))}
          previousLabel="Previous week"
          nextLabel="Next week"
          onPrevious={() => navigate(weeklyRoute(addWeeks(week, -1)))}
          onNext={() => navigate(weeklyRoute(addWeeks(week, 1)))}
        />
      </div>
      <WeekDays week={week} today={today} />
    </header>
  )
}

/** The week's seven days as quiet cards: weekday, number, daily-note dot. */
function WeekDays({ week, today }: { week: IsoWeek; today: string }): ReactElement {
  const navigateNoteLink = useNoteLinkNavigation()
  const noted = useDailyNoteDates(week.start, week.end)
  return (
    <ol className="mt-4 grid grid-cols-7 gap-1.5">
      {daysOfWeek(week).map((day) => {
        const date = parseIsoDate(day)
        const isToday = day === today
        const hasNote = noted.has(day)
        return (
          <li key={day} className="min-w-0">
            <button
              type="button"
              aria-label={`${format(date, 'EEEE, MMMM d')}${hasNote ? ', has daily note' : ''}`}
              aria-current={isToday ? 'date' : undefined}
              onClick={(event) =>
                navigateNoteLink({
                  target: { kind: 'daily', date: day },
                  openInSplit: isModEvent(event),
                })
              }
              className={cn(
                'flex w-full min-w-0 cursor-default flex-col items-center gap-0.5 rounded-xl py-2 transition-colors duration-150 ease-swift',
                isToday
                  ? 'bg-accent/10 hover:bg-accent/15'
                  : 'bg-surface-hover/60 hover:bg-surface-hover active:bg-surface-active',
              )}
            >
              <span
                className={cn(
                  'text-[11px] font-medium',
                  isToday ? 'text-accent' : 'text-text-muted',
                )}
              >
                {format(date, 'EEE')}
              </span>
              <span
                className={cn(
                  'text-base font-semibold tabular-nums',
                  isToday ? 'text-accent' : 'text-text',
                )}
              >
                {format(date, 'd')}
              </span>
              <span
                aria-hidden
                data-testid={hasNote ? `week-note-dot-${day}` : undefined}
                className={cn(
                  'size-1 rounded-full',
                  !hasNote && 'bg-transparent',
                  hasNote && (isToday ? 'bg-accent' : 'bg-text-muted'),
                )}
              />
            </button>
          </li>
        )
      })}
    </ol>
  )
}
