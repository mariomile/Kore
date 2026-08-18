import { describe, expect, it } from 'vitest'
import {
  nextOccurrenceContent,
  nextOccurrenceDate,
  taskContentDueDate,
  taskContentRepeat,
} from './task-repeat'

describe('taskContentRepeat', () => {
  it('parses word intervals', () => {
    expect(taskContentRepeat('water plants @repeat(daily)')).toEqual({ every: 1, unit: 'day' })
    expect(taskContentRepeat('review @repeat(weekly)')).toEqual({ every: 1, unit: 'week' })
    expect(taskContentRepeat('rent @repeat(monthly)')).toEqual({ every: 1, unit: 'month' })
    expect(taskContentRepeat('taxes @repeat(yearly)')).toEqual({ every: 1, unit: 'year' })
  })

  it('parses counted intervals', () => {
    expect(taskContentRepeat('sprint review @repeat(2w)')).toEqual({ every: 2, unit: 'week' })
    expect(taskContentRepeat('meds @repeat(10d)')).toEqual({ every: 10, unit: 'day' })
    expect(taskContentRepeat('quarterly @repeat(3m)')).toEqual({ every: 3, unit: 'month' })
  })

  it('is case-insensitive and tolerates inner padding', () => {
    expect(taskContentRepeat('x @REPEAT( Weekly )')).toEqual({ every: 1, unit: 'week' })
  })

  it('rejects prose and malformed specs', () => {
    expect(taskContentRepeat('no token here')).toBeNull()
    expect(taskContentRepeat('x @repeat(fortnightly)')).toBeNull()
    expect(taskContentRepeat('x @repeat(0d)')).toBeNull()
    expect(taskContentRepeat('x @repeat()')).toBeNull()
  })
})

describe('taskContentDueDate', () => {
  it('reads the first calendar link', () => {
    expect(taskContentDueDate('pay rent [[2026-07-01]] @repeat(monthly)')).toBe('2026-07-01')
    expect(taskContentDueDate('no date @repeat(weekly)')).toBeNull()
  })
})

describe('nextOccurrenceDate', () => {
  it('advances by the interval from the base', () => {
    expect(nextOccurrenceDate('2026-06-14', { every: 1, unit: 'week' }, '2026-06-14')).toBe(
      '2026-06-21',
    )
    expect(nextOccurrenceDate('2026-06-14', { every: 10, unit: 'day' }, '2026-06-14')).toBe(
      '2026-06-24',
    )
  })

  it('catches up past missed occurrences to land after today', () => {
    // A weekly task last due in January, completed in June: next week, not February.
    expect(nextOccurrenceDate('2026-01-05', { every: 1, unit: 'week' }, '2026-06-14')).toBe(
      '2026-06-15',
    )
  })

  it('clamps month-end dates', () => {
    expect(nextOccurrenceDate('2026-01-31', { every: 1, unit: 'month' }, '2026-01-31')).toBe(
      '2026-02-28',
    )
    expect(nextOccurrenceDate('2024-01-31', { every: 1, unit: 'month' }, '2024-01-31')).toBe(
      '2024-02-29',
    )
  })

  it('crosses year boundaries', () => {
    expect(nextOccurrenceDate('2026-12-28', { every: 1, unit: 'week' }, '2026-12-28')).toBe(
      '2027-01-04',
    )
    expect(nextOccurrenceDate('2026-03-01', { every: 1, unit: 'year' }, '2026-03-01')).toBe(
      '2027-03-01',
    )
  })
})

describe('nextOccurrenceContent', () => {
  it('advances the existing due-date link in place', () => {
    expect(
      nextOccurrenceContent(
        'pay rent [[2026-07-01]] @repeat(monthly)',
        { every: 1, unit: 'month' },
        '2026-07-01',
      ),
    ).toBe('pay rent [[2026-08-01]] @repeat(monthly)')
  })

  it('appends a date link when the task had none, based on today', () => {
    expect(
      nextOccurrenceContent('water plants @repeat(daily)', { every: 1, unit: 'day' }, '2026-06-14'),
    ).toBe('water plants @repeat(daily) [[2026-06-15]]')
  })
})
