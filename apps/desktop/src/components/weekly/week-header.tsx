import { useMemo, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  addWeeks,
  dailyDatesInRange,
  daysOfWeek,
  isoWeekOf,
  weeklyPath,
  type IsoWeek,
} from '@kore/core'
import { ChevronLeft, ChevronRight } from '@/components/icons'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { useNoteLinkNavigation } from '@/hooks/use-note-link-navigation'
import { useToday } from '@/lib/use-today'
import { parseIsoDate } from '@/lib/dates'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { cn } from '@/lib/utils'
import { useGraph } from '@/providers/graph-provider'
import { useRouter } from '@/routing/router'
import { isModEvent } from '@meowdown/core'

/** `Nov 16 – 22, 2026`, `Nov 30 – Dec 6, 2026`, `Dec 28, 2026 – Jan 3, 2027`. */
export function formatWeekRange(week: IsoWeek): string {
  const start = parseIsoDate(week.start)
  const end = parseIsoDate(week.end)
  if (start.getFullYear() !== end.getFullYear()) {
    return `${format(start, 'MMM d, yyyy')} – ${format(end, 'MMM d, yyyy')}`
  }
  if (start.getMonth() !== end.getMonth()) {
    return `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}`
  }
  return `${format(start, 'MMM d')} – ${format(end, 'd, yyyy')}`
}

interface WeekHeaderProps {
  week: IsoWeek
  className?: string
}

/**
 * The subject of a weekly note, in the daily subject's grammar: `Week 47`
 * display-sized over its date range, previous/next week in the same quiet
 * pill the daily stream floats, then the week's seven days. A day opens its
 * daily note (⌘-click beside this one); a dot marks days that have one,
 * today is tinted brand. The days are derived from the week key, never
 * written into the file, so the Markdown stays the user's own.
 */
export function WeekHeader({ week, className }: WeekHeaderProps): ReactElement {
  const { navigate } = useRouter()
  const navigateNoteLink = useNoteLinkNavigation()
  const today = useToday()
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const days = daysOfWeek(week)
  const { data: notedDates } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'dailyDates', week.start, week.end],
    queryFn: () => dailyDatesInRange(week.start, week.end),
    enabled: bridgeReady && graph !== null,
  })
  const noted = useMemo(() => new Set(notedDates ?? []), [notedDates])

  const isThisWeek = isoWeekOf(today).key === week.key

  const goWeek = (delta: number): void => {
    navigate({ kind: 'note', path: weeklyPath(addWeeks(week, delta)) })
  }

  return (
    <header aria-label={`Week ${week.week}`} className={cn('mb-1', className)}>
      <div className="flex items-start justify-between gap-3 border-b border-border pb-4">
        <div className="min-w-0">
          <h1 className="kore-daily-subject">Week {week.week}</h1>
          <p className="mt-1 text-sm text-text-muted">{formatWeekRange(week)}</p>
        </div>
        <div className="mt-1 flex shrink-0 items-center rounded-full border border-border bg-surface p-0.5 shadow-sm">
          <button
            type="button"
            aria-label="Previous week"
            title="Previous week"
            onClick={() => goWeek(-1)}
            className="app-icon-button text-text-muted hover:text-text"
          >
            <ChevronLeft aria-hidden className="size-3.5" />
          </button>
          <button
            type="button"
            title={isThisWeek ? undefined : 'Jump to this week'}
            disabled={isThisWeek}
            onClick={() => navigate({ kind: 'note', path: weeklyPath(isoWeekOf(today)) })}
            className="rounded-full px-1.5 text-xs font-medium text-text-secondary transition-colors duration-150 ease-swift hover:text-text disabled:text-text-muted disabled:hover:text-text-muted"
          >
            This week
          </button>
          <button
            type="button"
            aria-label="Next week"
            title="Next week"
            onClick={() => goWeek(1)}
            className="app-icon-button text-text-muted hover:text-text"
          >
            <ChevronRight aria-hidden className="size-3.5" />
          </button>
        </div>
      </div>

      <ol className="mt-4 grid grid-cols-7 gap-1.5">
        {days.map((day) => {
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
                  'flex w-full min-w-0 flex-col items-center gap-0.5 rounded-xl py-2 transition-colors duration-150 ease-swift',
                  'bg-surface-hover/60 hover:bg-surface-hover active:bg-surface-active',
                  isToday && 'bg-accent/10 hover:bg-accent/15',
                )}
              >
                <span
                  className={cn(
                    'text-[11px] font-medium text-text-muted',
                    isToday && 'text-accent',
                  )}
                >
                  {format(date, 'EEE')}
                </span>
                <span
                  className={cn(
                    'text-base font-semibold tabular-nums text-text',
                    isToday && 'text-accent',
                  )}
                >
                  {format(date, 'd')}
                </span>
                <span
                  aria-hidden
                  className={cn(
                    'size-1 rounded-full',
                    hasNote ? (isToday ? 'bg-accent' : 'bg-text-muted') : 'bg-transparent',
                  )}
                />
              </button>
            </li>
          )
        })}
      </ol>
    </header>
  )
}
