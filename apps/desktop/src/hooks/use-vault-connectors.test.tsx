import { useEffect, type ReactElement } from 'react'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  KoreError,
  DEFAULT_SETTINGS,
  setBridge,
  type ConnectorsSettings,
  type IpcBridge,
} from '@kore/core'

const device = vi.hoisted(() => ({
  connectors: null as ConnectorsSettings | null,
  updates: [] as Partial<{ connectors: ConnectorsSettings }>[],
}))

const settingsApi = vi.hoisted(() => ({
  updateSettingsWith: (updater: (current: { connectors: ConnectorsSettings }) => object) => {
    device.updates.push(
      updater({ connectors: device.connectors as ConnectorsSettings }) as Partial<{
        connectors: ConnectorsSettings
      }>,
    )
  },
  whenSettingsLoaded: () => Promise.resolve('loaded' as const),
}))

vi.mock('@/providers/settings-provider', () => ({
  // Stable functions, as the real provider's are.
  useSettings: () => ({ settings: { connectors: device.connectors }, ...settingsApi }),
}))

const { useVaultConnectors } = await import('./use-vault-connectors')

/** The vault-root `.kore.json`, as the fake bridge stores it. */
let file: string | null = null
const writes: string[] = []

function installBridge(): void {
  const bridge: IpcBridge = {
    invoke: async (command, args) => {
      if (command === 'vault_settings_read') {
        if (file === null) {
          throw new KoreError('notFound', 'no .kore.json')
        }
        return file
      }
      if (command === 'vault_settings_write') {
        file = (args as { contents: string }).contents
        writes.push(file)
        return null
      }
      return null
    },
    listen: async () => () => {},
  }
  setBridge(bridge)
}

function Probe({
  act,
}: {
  act?: (api: ReturnType<typeof useVaultConnectors>) => void
}): ReactElement {
  const api = useVaultConnectors(1)
  useEffect(() => {
    act?.(api)
  })
  const granola = api.connectors.granola
  return (
    <output aria-label="Granola">
      {`${granola.folder ?? 'default'}|${granola.syncEvery}|${String(granola.enabled)}`}
    </output>
  )
}

function deviceWith(change: Partial<ConnectorsSettings['granola']>): ConnectorsSettings {
  const defaults = DEFAULT_SETTINGS.connectors
  return { ...defaults, granola: { ...defaults.granola, ...change } }
}

beforeEach(() => {
  file = null
  writes.length = 0
  device.updates = []
  device.connectors = deviceWith({})
  installBridge()
})

afterEach(() => {
  setBridge(null)
})

describe('useVaultConnectors', () => {
  it('shows the vault’s shared fields over this device’s', async () => {
    device.connectors = deviceWith({ enabled: true, folder: 'Mine', syncEvery: 15 })
    file = JSON.stringify({ integrations: { granola: { folder: 'Shared', syncEvery: 60 } } })

    await render(<Probe />)

    await expect.element(page.getByLabelText('Granola')).toHaveTextContent('Shared|60|true')
    expect(writes).toEqual([])
  })

  it('copies this device’s choices into a vault that has none', async () => {
    device.connectors = deviceWith({ folder: 'Meetings', dailyLink: true })

    await render(<Probe />)

    await expect.poll(() => writes.length).toBe(1)
    expect(JSON.parse(writes[0] ?? '{}')).toMatchObject({
      integrations: { granola: { folder: 'Meetings', dailyLink: true } },
    })
  })

  it('writes shared fields to the vault and keeps sync state on the device', async () => {
    file = JSON.stringify({ integrations: { readwise: { folder: 'Readwise' } }, note: 'keep' })
    let done = false

    await render(
      <Probe
        act={(api) => {
          if (!done) {
            done = true
            api.update('granola', { folder: 'Input/Granola', enabled: true })
          }
        }}
      />,
    )

    await expect.element(page.getByLabelText('Granola')).toHaveTextContent('Input/Granola')
    await expect.poll(() => writes.length).toBe(1)
    expect(JSON.parse(writes[0] ?? '{}')).toEqual({
      integrations: { readwise: { folder: 'Readwise' }, granola: { folder: 'Input/Granola' } },
      note: 'keep',
    })
    expect(device.updates).toHaveLength(1)
    expect(device.updates[0]?.connectors?.granola).toMatchObject({ enabled: true })
    expect(device.updates[0]?.connectors?.granola.folder).toBeNull()
  })

  it('picks up another device’s change on refresh', async () => {
    file = JSON.stringify({ integrations: { granola: { syncEvery: 15 } } })
    let api: ReturnType<typeof useVaultConnectors> | null = null

    await render(<Probe act={(current) => (api = current)} />)
    await expect.element(page.getByLabelText('Granola')).toHaveTextContent('|15|')

    file = JSON.stringify({ integrations: { granola: { syncEvery: 'launch' } } })
    const merged = await (api as unknown as ReturnType<typeof useVaultConnectors>).refresh()

    expect(merged.granola.syncEvery).toBe('launch')
    await expect.element(page.getByLabelText('Granola')).toHaveTextContent('|launch|')
  })

  it('leaves a broken vault file alone instead of adopting over it', async () => {
    device.connectors = deviceWith({ folder: 'Meetings' })
    file = '{ "integrations": <<<<<<< HEAD'

    await render(<Probe />)

    await expect.element(page.getByLabelText('Granola')).toHaveTextContent('Meetings|')
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(writes).toEqual([])
  })

  it('keeps the shared fields when a refresh cannot read the file', async () => {
    device.connectors = deviceWith({ folder: 'Mine' })
    file = JSON.stringify({ integrations: { granola: { folder: 'Shared' } } })
    let api: ReturnType<typeof useVaultConnectors> | null = null

    await render(<Probe act={(current) => (api = current)} />)
    await expect.element(page.getByLabelText('Granola')).toHaveTextContent('Shared|')

    file = '{ truncated'
    const merged = await (api as unknown as ReturnType<typeof useVaultConnectors>).refresh()

    expect(merged.granola.folder).toBe('Shared')
  })
})
