import { describe, expect, it } from 'vitest'
import {
  addWeeks,
  daysOfWeek,
  isoWeekFromKey,
  isoWeekOf,
  isoWeekOfCalendarRow,
  weekFromWeeklyPath,
  weeklyNoteTitle,
  weeklyPath,
} from './weekly'

describe('isoWeekOf', () => {
  it('names the Monday-to-Sunday ISO week a date falls in', () => {
    expect(isoWeekOf('2026-11-18')).toEqual({
      key: '2026-W47',
      year: 2026,
      week: 47,
      start: '2026-11-16',
      end: '2026-11-22',
    })
    expect(isoWeekOf('2026-11-16').key).toBe('2026-W47')
    expect(isoWeekOf('2026-11-22').key).toBe('2026-W47')
  })

  it('gives a week to the year that holds its Thursday', () => {
    // 2027-01-01 is a Friday: its week belongs to 2026, which has 53 weeks.
    expect(isoWeekOf('2027-01-01').key).toBe('2026-W53')
    // 2024-12-30 is a Monday whose Thursday is in 2025.
    expect(isoWeekOf('2024-12-30').key).toBe('2025-W01')
    expect(isoWeekOf('2026-01-01').key).toBe('2026-W01')
  })
})

describe('isoWeekFromKey', () => {
  it('round-trips a key', () => {
    expect(isoWeekFromKey('2026-W47')).toEqual(isoWeekOf('2026-11-18'))
    expect(isoWeekFromKey('2026-W53')?.start).toBe('2026-12-28')
  })

  it('rejects keys that name no week of their year', () => {
    expect(isoWeekFromKey('2025-W53')).toBeNull()
    expect(isoWeekFromKey('2026-W00')).toBeNull()
    expect(isoWeekFromKey('2026-W7')).toBeNull()
    expect(isoWeekFromKey('2026-47')).toBeNull()
  })
})

describe('week arithmetic', () => {
  it('steps whole weeks across a year boundary', () => {
    const last = isoWeekFromKey('2026-W53')!
    expect(addWeeks(last, 1).key).toBe('2027-W01')
    expect(addWeeks(addWeeks(last, 1), -1).key).toBe('2026-W53')
  })

  it('lists the seven days, Monday first', () => {
    expect(daysOfWeek(isoWeekOf('2026-11-18'))).toEqual([
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
      '2026-11-21',
      '2026-11-22',
    ])
  })

  it('finds a calendar row’s week whatever day the row starts on', () => {
    expect(isoWeekOfCalendarRow('2026-11-16', 1).key).toBe('2026-W47') // Monday start
    expect(isoWeekOfCalendarRow('2026-11-15', 0).key).toBe('2026-W47') // Sunday start
    expect(isoWeekOfCalendarRow('2026-11-14', 6).key).toBe('2026-W47') // Saturday start
  })
})

describe('weekly paths', () => {
  it('maps a week to weekly/YYYY-Www.md and back', () => {
    const week = isoWeekOf('2026-11-18')
    expect(weeklyPath(week)).toBe('weekly/2026-W47.md')
    expect(weeklyPath('2026-W47')).toBe('weekly/2026-W47.md')
    expect(weekFromWeeklyPath('weekly/2026-W47.md')).toEqual(week)
    expect(weeklyNoteTitle(week)).toBe('Week 47')
  })

  it('leaves other paths alone', () => {
    expect(weekFromWeeklyPath('weekly/2026-W60.md')).toBeNull()
    expect(weekFromWeeklyPath('notes/2026-W47.md')).toBeNull()
    expect(weekFromWeeklyPath('weekly/2026-W47.txt')).toBeNull()
    expect(weekFromWeeklyPath('weekly/sub/2026-W47.md')).toBeNull()
    expect(() => weeklyPath('2026-W60')).toThrow()
  })
})
