import { format } from 'date-fns'
import type { CalendarEvent } from '@reflect/core'
import { addDaysIso, parseIsoDate } from '@/lib/dates'

/**
 * Day grouping for the sidebar's Meetings rail: the upcoming-events window is
 * one flat `displayEvents` list, and the rail renders it as one group of rows
 * per local calendar day. Pure date math so the policy is testable without a
 * calendar bridge.
 */

export interface EventDayGroup {
  /** The group's local calendar day as an ISO `YYYY-MM-DD` date. */
  readonly date: string
  readonly events: readonly CalendarEvent[]
}

/** The local calendar day an event starts on, as an ISO date. */
export function eventDay(event: CalendarEvent): string {
  return format(new Date(event.startsAt), 'yyyy-MM-dd')
}

/**
 * Group a start-ordered event list (the `displayEvents` contract) into one
 * entry per local day, in day order. Events keep their in-day ordering.
 */
export function groupEventsByDay(events: readonly CalendarEvent[]): EventDayGroup[] {
  const groups: { date: string; events: CalendarEvent[] }[] = []
  for (const event of events) {
    const date = eventDay(event)
    const current = groups.at(-1)
    if (current !== undefined && current.date === date) {
      current.events.push(event)
    } else {
      groups.push({ date, events: [event] })
    }
  }
  return groups
}

/**
 * The header a day group renders under: `Today`, `Tomorrow`, then the full
 * weekday name — unambiguous inside the rail's one-week window, and quieter
 * than a full date in a 260px column.
 */
export function upcomingDayLabel(date: string, today: string): string {
  if (date === today) {
    return 'Today'
  }
  if (date === addDaysIso(today, 1)) {
    return 'Tomorrow'
  }
  return format(parseIsoDate(date), 'EEEE')
}
