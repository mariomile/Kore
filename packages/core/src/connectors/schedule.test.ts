import { describe, expect, it } from 'vitest'
import { connectorsSchema, type ConnectorSettings } from '../settings/schema'
import { granolaConnector } from './granola'
import { connectorRunSettings, isConnectorSyncDue } from './schedule'

const base: ConnectorSettings = connectorsSchema.parse({}).granola
const at = (iso: string): number => Date.parse(iso)

describe('isConnectorSyncDue', () => {
  const start = at('2026-11-17T09:00:00Z')
  const now = at('2026-11-17T10:00:00Z')

  it('runs a never-synced source unless it is manual', () => {
    expect(isConnectorSyncDue({ ...base, syncEvery: 15 }, now, start)).toBe(true)
    expect(isConnectorSyncDue({ ...base, syncEvery: 'launch' }, now, start)).toBe(true)
    expect(isConnectorSyncDue({ ...base, syncEvery: 'manual' }, now, start)).toBe(false)
  })

  it('honours the interval in minutes', () => {
    const entry = { ...base, syncEvery: 30 as const, lastSyncedAt: '2026-11-17T09:40:00.000Z' }
    expect(isConnectorSyncDue(entry, now, start)).toBe(false)
    expect(isConnectorSyncDue(entry, at('2026-11-17T10:10:00Z'), start)).toBe(true)
  })

  it('runs a launch source once per session', () => {
    const before = {
      ...base,
      syncEvery: 'launch' as const,
      lastSyncedAt: '2026-11-16T20:00:00.000Z',
    }
    const after = { ...before, lastSyncedAt: '2026-11-17T09:01:00.000Z' }
    expect(isConnectorSyncDue(before, now, start)).toBe(true)
    expect(isConnectorSyncDue(after, now, start)).toBe(false)
  })
})

describe('connectorRunSettings', () => {
  it('fills the defaults and links daily notes only when asked', () => {
    expect(connectorRunSettings(granolaConnector, base)).toMatchObject({
      folder: granolaConnector.defaultFolder,
      dailyHeading: null,
      since: null,
      floor: null,
    })
    const linked = connectorRunSettings(granolaConnector, {
      ...base,
      dailyLink: true,
      lastSyncedAt: '2026-11-17T09:00:00.000Z',
    })
    expect(linked.dailyHeading).toBe('Meetings')
    expect(linked.since).toEqual(new Date('2026-11-17T09:00:00.000Z'))
  })
})
