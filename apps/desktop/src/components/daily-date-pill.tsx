import type { ReactElement } from 'react'
import { ChevronLeft, ChevronRight } from '@/components/icons'
import { addDaysIso, formatDayPillLabel } from '@/lib/dates'
import { useToday } from '@/lib/use-today'
import { useFocusedDailyDate } from '@/providers/focused-daily-provider'
import { useSettings } from '@/providers/settings-provider'
import { effectiveDailyDate } from '@/routing/route'
import { useRouter } from '@/routing/router'

/**
 * Craft's daily navigation (Plan 28 slice 3): a floating ‹ date › pill over
 * the stream's top edge. It names the day being read — the focused day,
 * falling back to the routed one — the chevrons hop to the adjacent day,
 * and the date itself jumps back to today. Floating chrome, never a bar:
 * the stream's content melts under it through the scroll veil.
 *
 * Subscribed to the focused-day value here, not in the stream — the stream
 * deliberately consumes only the (stable) setter so day-to-day focus moves
 * never re-render every mounted editor; this pill is the one thing that
 * re-renders instead.
 */
export function DailyDatePill(): ReactElement | null {
  const { route, navigate } = useRouter()
  const today = useToday()
  const focused = useFocusedDailyDate()
  const { settings } = useSettings()
  const date = effectiveDailyDate(route, today, focused)
  if (date === null) {
    return null // not a daily surface (the stream never renders one, but stay honest)
  }
  return (
    <div className="pointer-events-auto flex items-center rounded-full border border-border bg-surface p-0.5 shadow-sm">
      <button
        type="button"
        aria-label="Previous day"
        title="Previous day"
        onClick={() => navigate({ kind: 'daily', date: addDaysIso(date, -1) })}
        className="app-icon-button text-text-muted hover:text-text"
      >
        <ChevronLeft aria-hidden className="size-3.5" />
      </button>
      <button
        type="button"
        title="Jump to today"
        onClick={() => navigate({ kind: 'today' })}
        className="rounded-full px-1.5 text-xs font-medium text-text-secondary transition-colors duration-150 ease-swift hover:text-text"
      >
        {formatDayPillLabel(date, settings.dateFormat)}
      </button>
      <button
        type="button"
        aria-label="Next day"
        title="Next day"
        onClick={() => navigate({ kind: 'daily', date: addDaysIso(date, 1) })}
        className="app-icon-button text-text-muted hover:text-text"
      >
        <ChevronRight aria-hidden className="size-3.5" />
      </button>
    </div>
  )
}
