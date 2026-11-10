import { describe, expect, it } from 'vitest'
import { localCalendarDate } from './timestamps'

describe('localCalendarDate', () => {
  it('formats the local calendar day, zero-padded', () => {
    expect(localCalendarDate(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(localCalendarDate(new Date(2026, 11, 31))).toBe('2026-12-31')
  })
})
