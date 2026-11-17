import { describe, expect, it } from 'vitest'
import { connectorsSchema, type ConnectorsSettings } from '../settings/schema-connectors'
import {
  adoptDeviceConnectors,
  mergeVaultConnectors,
  parseVaultSettings,
  serializeVaultSettings,
  splitConnectorChange,
  withVaultConnector,
} from './vault-settings'

function device(change: Partial<ConnectorsSettings['granola']> = {}): ConnectorsSettings {
  const defaults = connectorsSchema.parse({})
  return { ...defaults, granola: { ...defaults.granola, ...change } }
}

describe('parseVaultSettings', () => {
  it('reads a missing or broken file as empty', () => {
    expect(parseVaultSettings(null)).toEqual({})
    expect(parseVaultSettings('{ not json')).toEqual({})
    expect(parseVaultSettings('[1, 2]')).toEqual({})
  })

  it('keeps keys it does not know', () => {
    const text = '{"integrations":{"granola":{"folder":"Meetings"}},"agent":{"note":"x"}}'
    expect(parseVaultSettings(text)).toEqual({
      integrations: { granola: { folder: 'Meetings' } },
      agent: { note: 'x' },
    })
  })
})

describe('mergeVaultConnectors', () => {
  it('takes the vault fields over the device ones and keeps the device state', () => {
    const local = device({ enabled: true, lastSyncedAt: '2026-11-17T10:00:00.000Z' })
    const vault = parseVaultSettings(
      JSON.stringify({
        integrations: {
          granola: { folder: 'Input/Granola', syncEvery: 60, dailyLink: true, enabled: false },
        },
      }),
    )

    const merged = mergeVaultConnectors(local, vault)

    expect(merged.granola).toMatchObject({
      folder: 'Input/Granola',
      syncEvery: 60,
      dailyLink: true,
      enabled: true,
      lastSyncedAt: '2026-11-17T10:00:00.000Z',
    })
    expect(merged.readwise).toBe(local.readwise)
  })

  it('falls back to the device for a malformed field only', () => {
    const local = device({ syncEvery: 30, folder: 'Mine' })
    const vault = parseVaultSettings(
      JSON.stringify({ integrations: { granola: { syncEvery: 7, folder: 'Shared' } } }),
    )

    expect(mergeVaultConnectors(local, vault).granola).toMatchObject({
      syncEvery: 30,
      folder: 'Shared',
    })
  })
})

describe('splitConnectorChange', () => {
  it('sends layout to the vault and sync state to the device', () => {
    expect(
      splitConnectorChange({ folder: 'A', enabled: true, lastSyncedAt: null, dailyLink: true }),
    ).toEqual({
      shared: { folder: 'A', dailyLink: true },
      device: { enabled: true, lastSyncedAt: null },
    })
  })
})

describe('withVaultConnector', () => {
  it('changes one connector and keeps everything else', () => {
    const vault = parseVaultSettings(
      JSON.stringify({
        integrations: { granola: { folder: 'A', tags: ['x'] }, readwise: { folder: 'R' } },
        other: 1,
      }),
    )

    expect(withVaultConnector(vault, 'granola', { folder: 'B' })).toEqual({
      integrations: { granola: { folder: 'B', tags: ['x'] }, readwise: { folder: 'R' } },
      other: 1,
    })
  })
})

describe('adoptDeviceConnectors', () => {
  it('copies a device’s changed settings into a vault that has none', () => {
    const next = adoptDeviceConnectors(device({ folder: 'Meetings', dailyLink: true }), {})

    expect(next?.integrations?.['granola']).toMatchObject({ folder: 'Meetings', dailyLink: true })
    expect(next?.integrations?.['readwise']).toBeUndefined()
  })

  it('leaves a vault alone when it already has the connector or the device is untouched', () => {
    const vault = parseVaultSettings('{"integrations":{"granola":{"folder":"Shared"}}}')
    expect(adoptDeviceConnectors(device({ folder: 'Mine' }), vault)).toBeNull()
    expect(adoptDeviceConnectors(device({ enabled: true }), {})).toBeNull()
  })
})

describe('serializeVaultSettings', () => {
  it('writes indented JSON that parses back', () => {
    const vault = withVaultConnector({}, 'granola', { folder: 'A' })
    const text = serializeVaultSettings(vault)
    expect(text.endsWith('}\n')).toBe(true)
    expect(parseVaultSettings(text)).toEqual(vault)
  })
})
