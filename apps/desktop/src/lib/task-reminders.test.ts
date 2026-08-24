import { describe, expect, it } from 'vitest'
import {
  digestCounts,
  dueTimeToMinutes,
  parsePunctualFireState,
  punctualReminderBody,
  punctualTaskKey,
  punctualTasksReady,
  serializePunctualFireState,
  type ReminderTask,
} from './task-reminders'

function task(overrides: Partial<ReminderTask> = {}): ReminderTask {
  return {
    notePath: 'notes/a.md',
    markerOffset: 0,
    text: 'call',
    dueDate: '2026-08-24',
    dueTime: null,
    ...overrides,
  }
}

describe('dueTimeToMinutes', () => {
  it('parses HH:MM and rejects impossible times', () => {
    expect(dueTimeToMinutes('00:00')).toBe(0)
    expect(dueTimeToMinutes('14:30')).toBe(14 * 60 + 30)
    expect(dueTimeToMinutes('24:00')).toBeNull()
    expect(dueTimeToMinutes('9:05')).toBeNull()
  })
})

describe('digestCounts', () => {
  it('counts date-only due-today tasks and every overdue task', () => {
    expect(
      digestCounts(
        [
          task({ dueDate: '2026-08-24', dueTime: null, text: 'today' }),
          task({ dueDate: '2026-08-24', dueTime: '14:30', text: 'later' }),
          task({ dueDate: '2026-08-20', dueTime: '09:00', text: 'late timed' }),
          task({ dueDate: '2026-08-20', dueTime: null, text: 'late' }),
          task({ dueDate: null, text: 'someday' }),
        ],
        '2026-08-24',
      ),
    ).toEqual({ dueToday: 1, overdue: 2 })
  })
})

describe('punctualTasksReady', () => {
  it('fires timed tasks at or after their clock time, once', () => {
    const dentist = task({
      markerOffset: 4,
      text: 'dentist',
      dueDate: '2026-08-24',
      dueTime: '14:30',
    })
    const ready = punctualTasksReady([dentist], '2026-08-24', 14 * 60 + 30, new Set())
    expect(ready).toEqual([dentist])
    const fired = new Set([punctualTaskKey(dentist)])
    expect(punctualTasksReady([dentist], '2026-08-24', 18 * 60, fired)).toEqual([])
  })

  it('does not fire before the due time or on another day', () => {
    const dentist = task({ dueTime: '14:30' })
    expect(punctualTasksReady([dentist], '2026-08-24', 14 * 60 + 29, new Set())).toEqual([])
    expect(punctualTasksReady([dentist], '2026-08-23', 18 * 60, new Set())).toEqual([])
  })
})

describe('punctualReminderBody', () => {
  it('includes the task text and time', () => {
    expect(punctualReminderBody(task({ text: 'Dentist', dueTime: '14:30' }))).toBe(
      'Dentist · 14:30',
    )
    expect(punctualReminderBody(task({ text: '  ', dueTime: '09:00' }))).toBe('Open task at 09:00')
  })
})

describe('punctual fire state', () => {
  it("round-trips keys for today and drops yesterday's set", () => {
    const raw = serializePunctualFireState('2026-08-24', new Set(['a:1:2026-08-24:14:30']))
    expect([...parsePunctualFireState(raw, '2026-08-24')]).toEqual(['a:1:2026-08-24:14:30'])
    expect(parsePunctualFireState(raw, '2026-08-25').size).toBe(0)
    expect(parsePunctualFireState('not-json', '2026-08-24').size).toBe(0)
  })
})
