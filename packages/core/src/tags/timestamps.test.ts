import { describe, expect, it } from 'vitest'
import { createdStampValues, localCalendarDate, missingCreatedStamps } from './timestamps'
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

describe('missingCreatedStamps', () => {
  const type: TagType = {
    properties: [
      { name: 'Added', key: 'added', type: 'created' },
      { name: 'Started', key: 'started', type: 'created' },
      { name: 'Due', key: 'due', type: 'date' },
    ],
  }
  const at = new Date(2026, 8, 22)

  it('stamps every created key a note does not already carry', () => {
    expect(missingCreatedStamps('# A book\n', type, at)).toEqual({
      added: '2026-09-22',
      started: '2026-09-22',
    })
  })

  it('leaves a key the note already stores alone', () => {
    const source = '---\nadded: 2019-04-01\n---\n# A book\n'
    expect(missingCreatedStamps(source, type, at)).toEqual({ started: '2026-09-22' })
  })

  it('stamps nothing for an untyped tag or a schema without created columns', () => {
    expect(missingCreatedStamps('# A book\n', null, at)).toEqual({})
    expect(
      missingCreatedStamps(
        '# A book\n',
        { properties: [{ name: 'Due', key: 'due', type: 'date' }] },
        at,
      ),
    ).toEqual({})
  })
})
