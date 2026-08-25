import { describe, expect, it } from 'vitest'
import type { CalendarEvent } from '@reflect/core'
import { eventDay, groupEventsByDay, upcomingDayLabel } from './upcoming-events'

function event(overrides: Partial<CalendarEvent> & Pick<CalendarEvent, 'startsAt'>): CalendarEvent {
  return {
    id: 'event',
    calendarId: 'calendar',
    title: 'Standup',
    endsAt: overrides.startsAt + 30 * 60_000,
    allDay: false,
    recurring: false,
    availability: 'busy',
    canceled: false,
    attendees: [],
    ...overrides,
  }
}

/** Epoch milliseconds for a local wall-clock time. */
function localTime(year: number, month: number, day: number, hour: number, minute: number): number {
  return new Date(year, month - 1, day, hour, minute).getTime()
}

describe('eventDay', () => {
  it('uses the local calendar day, not the UTC one', () => {
    const lateEvening = event({ startsAt: localTime(2026, 8, 24, 23, 30) })
    expect(eventDay(lateEvening)).toBe('2026-08-24')
  })
})

describe('groupEventsByDay', () => {
  it('groups a start-ordered list into one entry per day, order kept', () => {
    const monday1 = event({ id: 'a', startsAt: localTime(2026, 8, 24, 9, 0) })
    const monday2 = event({ id: 'b', startsAt: localTime(2026, 8, 24, 15, 0) })
    const wednesday = event({ id: 'c', startsAt: localTime(2026, 8, 26, 10, 0) })

    expect(groupEventsByDay([monday1, monday2, wednesday])).toEqual([
      { date: '2026-08-24', events: [monday1, monday2] },
      { date: '2026-08-26', events: [wednesday] },
    ])
  })

  it('returns no groups for no events', () => {
    expect(groupEventsByDay([])).toEqual([])
  })
})

describe('upcomingDayLabel', () => {
  it('labels today, tomorrow, and the rest of the week', () => {
    expect(upcomingDayLabel('2026-08-24', '2026-08-24')).toBe('Today')
    expect(upcomingDayLabel('2026-08-25', '2026-08-24')).toBe('Tomorrow')
    expect(upcomingDayLabel('2026-08-26', '2026-08-24')).toBe('Wednesday')
  })
})
