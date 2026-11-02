import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, setBridge, type RemoteAccessState } from '@reflect/core'
import { RemoteAccessRunner } from '@/components/remote-access-runner'
import { remoteAccessPhase, setRemoteAccessPhase } from '@/lib/remote-access-store'
import { AgentsRemoteAccessField } from './agents-remote-access-field'

vi.mock('@/lib/platform', () => ({ isMacosDesktop: true, isNativeShell: () => true }))

vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/graphs/Personal', name: 'Personal', generation: 7 } }),
}))

const settingsMock = vi.hoisted(() => ({
  enabled: true,
  updates: [] as unknown[],
}))

vi.mock('@/providers/settings-provider', () => ({
  useSettings: () => ({
    settings: { ...DEFAULT_SETTINGS, remoteAccessEnabled: settingsMock.enabled },
    updateSettings: (patch: unknown) => {
      settingsMock.updates.push(patch)
    },
  }),
}))

const server = {
  running: true,
  port: 8765,
  graphRoot: '/graphs/Personal',
  readOnly: true,
  exitMessage: null,
}

function state(tunnel: RemoteAccessState['tunnel']): RemoteAccessState {
  return {
    server,
    localUrl: 'http://127.0.0.1:8765/mcp',
    publicUrl:
      tunnel.kind === 'on' || tunnel.kind === 'needs-enable'
        ? 'https://mac.tail1.ts.net/mcp'
        : null,
    tunnel,
  }
}

let calls: { command: string; args: Record<string, unknown> }[]

beforeEach(() => {
  calls = []
  settingsMock.enabled = true
  settingsMock.updates = []
  setRemoteAccessPhase({ kind: 'off' })
  setBridge({
    invoke: async (command, args = {}) => {
      calls.push({ command, args })
      switch (command) {
        case 'secret_get':
          return 'f'.repeat(64)
        case 'tailscale_run':
          return {
            found: true,
            code: 0,
            stdout: JSON.stringify({
              BackendState: 'Running',
              Self: { DNSName: 'mac.tail1.ts.net.' },
            }),
            stderr: '',
            timedOut: false,
          }
        case 'remote_mcp_start':
          return server
        default:
          throw new Error(`unexpected command ${command}`)
      }
    },
    listen: async () => () => {},
  })
})

afterEach(() => setBridge(null))

describe('AgentsRemoteAccessField', () => {
  it('shows the public URL to copy once Funnel is live', async () => {
    setRemoteAccessPhase({ kind: 'on', state: state({ kind: 'on' }) })
    await render(<AgentsRemoteAccessField graphName="Personal" />)
    await expect.element(page.getByText('On, reachable from the internet')).toBeInTheDocument()
    await expect.element(page.getByText('https://mac.tail1.ts.net/mcp')).toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: 'Copy URL' })).toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: 'Copy token' })).toBeInTheDocument()
  })

  it('offers to turn Funnel on when the tailnet has it off', async () => {
    setRemoteAccessPhase({
      kind: 'on',
      state: state({
        kind: 'needs-enable',
        enableUrl: 'https://login.tailscale.com/f/funnel?node=n1',
      }),
    })
    await render(<AgentsRemoteAccessField graphName="Personal" />)
    await expect.element(page.getByRole('button', { name: 'Turn on Funnel' })).toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('the switch writes the setting', async () => {
    settingsMock.enabled = false
    await render(<AgentsRemoteAccessField graphName="Personal" />)
    await expect.element(page.getByText('Off', { exact: true })).toBeInTheDocument()
    expect(page.getByRole('button', { name: 'Copy token' }).query()).toBeNull()
    await page.getByRole('switch', { name: 'Remote access' }).click()
    expect(settingsMock.updates).toEqual([{ remoteAccessEnabled: true }])
  })
})

describe('RemoteAccessRunner', () => {
  it('starts the server for the open graph when the setting is on', async () => {
    await render(<RemoteAccessRunner />)
    await expect.poll(() => remoteAccessPhase().kind).toBe('on')
    expect(calls.find((call) => call.command === 'remote_mcp_start')?.args).toMatchObject({
      generation: 7,
      port: 8765,
      readOnly: true,
      publicUrl: 'https://mac.tail1.ts.net',
    })
  })
})
