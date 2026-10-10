import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { DEFAULT_SETTINGS, ReflectError, type Settings } from '@reflect/core'

const updated = vi.hoisted(() => [] as Partial<Settings>[])
vi.mock('@/providers/settings-provider', () => ({
  useSettings: () => ({
    settings: DEFAULT_SETTINGS,
    updateSettingsWith: (updater: (current: Settings) => Partial<Settings>) => {
      updated.push(updater(DEFAULT_SETTINGS))
    },
    whenSettingsLoaded: async () => 'loaded',
  }),
}))
const syncNow = vi.hoisted(() => vi.fn())
vi.mock('@/providers/connector-sync-provider', () => ({
  useConnectorSync: () => ({ snapshot: { running: null, statuses: {} }, syncNow }),
}))
const connectConnector = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  hasBridge: () => true,
  isConnectorConnected: async () => false,
  connectConnector,
}))

const { ConnectorsSection } = await import('./connectors-section')

describe('ConnectorsSection', () => {
  it('connects a source with a verified token and starts syncing from now on', async () => {
    updated.length = 0
    const view = await render(<ConnectorsSection />)

    await view.getByLabelText('Readwise Access token').fill(' rw-token ')
    await view.getByRole('button', { name: 'Connect', exact: true }).first().click()

    await vi.waitFor(() => expect(syncNow).toHaveBeenCalled())
    expect(connectConnector).toHaveBeenCalledWith('readwise', ' rw-token ', expect.any(Function))
    expect(updated.at(-1)?.connectors?.readwise).toMatchObject({
      enabled: true,
      lastSyncedAt: null,
      importFrom: expect.any(String),
    })
    await view.unmount()
  })

  it('shows why a rejected token was not saved', async () => {
    connectConnector.mockRejectedValueOnce(
      new ReflectError('auth', 'Readwise rejected the access token'),
    )
    const view = await render(<ConnectorsSection />)

    await view.getByLabelText('Readwise Access token').fill('wrong')
    await view.getByRole('button', { name: 'Connect', exact: true }).first().click()

    await expect.element(view.getByText('Readwise rejected the access token')).toBeVisible()
    await view.unmount()
  })
})
