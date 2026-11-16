import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setBridge } from '@kore/core'
import { setRemoteAccessPhase } from '@/lib/remote-access-store'
import { AgentsConnectField } from './agents-connect-field'

const updateSettings = vi.fn()
vi.mock('@/providers/settings-provider', async () => {
  const { DEFAULT_SETTINGS } = await import('@kore/core')
  return { useSettings: () => ({ settings: DEFAULT_SETTINGS, updateSettings }) }
})

const KORE = '/Applications/Kore.app/Contents/MacOS/kore'
let servers: unknown[]
let calls: Array<{ command: string; args: Record<string, unknown> | undefined }>
let secrets: Record<string, string>

function installBridge(): void {
  calls = []
  secrets = {}
  setBridge({
    invoke: async (command, args) => {
      calls.push({ command, args })
      switch (command) {
        case 'mcp_client_servers':
          return servers
        case 'mcp_client_connect':
          servers = [
            { client: 'Claude Desktop', name: 'kore', command: KORE, args: ['mcp'], env: {} },
          ]
          return null
        case 'secret_get':
          return secrets[String(args?.name)] ?? null
        case 'secret_set':
          secrets[String(args?.name)] = String(args?.value)
          return null
        default:
          throw new Error(`unexpected command ${command}`)
      }
    },
    listen: async () => () => {},
  })
}

async function renderField(): Promise<void> {
  await render(
    <QueryClientProvider client={new QueryClient()}>
      <AgentsConnectField cliPath={KORE} />
    </QueryClientProvider>,
  )
}

describe('AgentsConnectField', () => {
  afterEach(() => {
    setBridge(null)
    setRemoteAccessPhase({ kind: 'off' })
    updateSettings.mockReset()
  })

  it('connects an app on this Mac in one click, replacing its older Kore entry', async () => {
    servers = [
      {
        client: 'Claude Desktop',
        name: 'kore-brain',
        command: KORE,
        args: ['--graph', '/v', 'mcp'],
        env: {},
      },
    ]
    installBridge()
    await renderField()
    await page.getByRole('button', { name: 'Update' }).click()

    await expect.element(page.getByText('Quit and reopen Claude Desktop')).toBeVisible()
    await expect.element(page.getByText('Connected', { exact: true })).toBeVisible()
    expect(calls.find((call) => call.command === 'mcp_client_connect')?.args).toEqual({
      client: 'claude-desktop',
      name: 'kore',
      command: KORE,
      args: ['mcp'],
      replace: ['kore-brain'],
    })
  })

  it('connects ChatGPT: turns on Remote access, makes its key, then shows what to paste', async () => {
    servers = []
    installBridge()
    await renderField()
    await page.getByRole('listitem').filter({ hasText: 'ChatGPT' }).getByRole('button').click()

    expect(updateSettings).toHaveBeenCalledWith({ remoteAccessEnabled: true })
    expect(secrets['kore-mcp-agents']).toContain('"ChatGPT"')
    await expect.element(page.getByText('Turning on Remote access…')).toBeVisible()

    setRemoteAccessPhase({
      kind: 'on',
      state: {
        server: { running: true, port: 8765, graphRoot: '/v', readOnly: false, exitMessage: null },
        localUrl: 'http://127.0.0.1:8765/mcp',
        publicUrl: 'https://mac.tail.ts.net/mcp',
        tunnel: { kind: 'on' },
      },
    })
    await expect.element(page.getByRole('button', { name: 'Copy address' })).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Open ChatGPT' })).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Copy key' })).toBeVisible()
  })
})
