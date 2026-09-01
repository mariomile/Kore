import { describe, expect, it } from 'vitest'
import { createdStampValues, localCalendarDate } from './timestamps'
import type { TagType } from './tag-type'

describe('localCalendarDate', () => {
  it('formats the local calendar day, zero-padded', () => {
    expect(localCalendarDate(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(localCalendarDate(new Date(2026, 11, 31))).toBe('2026-12-31')
  })
})

describe('createdStampValues', () => {
  const type: TagType = {
    properties: [
      { name: 'Started', key: 'started', type: 'created' },
      { name: 'Touched', key: 'touched', type: 'updated' },
      { name: 'Due', key: 'due', type: 'date' },
    ],
  }

  it('stamps every created property with the local day, nothing else', () => {
    expect(createdStampValues(type, new Date(2026, 7, 31))).toEqual({
      started: '2026-08-31',
    })
  })

  it('is empty for an untyped tag or a schema without created properties', () => {
    expect(createdStampValues(null)).toEqual({})
    expect(createdStampValues({ properties: [{ name: 'Due', key: 'due', type: 'date' }] })).toEqual(
      {},
    )
  })
})
