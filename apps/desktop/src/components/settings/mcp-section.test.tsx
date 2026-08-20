import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import type { McpServer, Settings } from '@reflect/core'

const settingsState = vi.hoisted(() => ({
  mcpServers: [] as McpServer[],
}))
const updated = vi.hoisted(() => [] as Partial<Settings>[])
vi.mock('@/providers/settings-provider', () => ({
  SETTINGS_QUERY_KEY: ['settings'],
  useSettings: () => ({
    settings: { mcpServers: settingsState.mcpServers },
    updateSettings: (patch: Partial<Settings>) => {
      updated.push(patch)
    },
    updateSettingsWith: (updater: (current: { mcpServers: McpServer[] }) => Partial<Settings>) => {
      updated.push(updater({ mcpServers: settingsState.mcpServers }))
    },
  }),
}))
const setSecret = vi.hoisted(() => vi.fn(async () => {}))
const deleteSecret = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  setSecret,
  deleteSecret,
}))

const { McpSection } = await import('./mcp-section')

const GITHUB: McpServer = {
  id: 'id-1',
  name: 'github',
  transport: { kind: 'stdio', command: 'npx', args: ['-y', 'server-github'] },
  envKeys: ['GITHUB_TOKEN'],
  enabled: true,
}

function reset(servers: McpServer[]): void {
  settingsState.mcpServers = servers
  updated.length = 0
  setSecret.mockClear()
  deleteSecret.mockClear()
}

describe('McpSection', () => {
  it('lists a server with its command, keychain keys, and controls', async () => {
    reset([GITHUB])
    const view = await render(<McpSection />)
    await expect.element(view.getByText('github', { exact: true })).toBeVisible()
    await expect
      .element(view.getByText('npx -y server-github · GITHUB_TOKEN in keychain'))
      .toBeVisible()

    await view.getByRole('switch', { name: 'github enabled' }).click()
    expect(updated.at(-1)?.mcpServers?.[0]).toMatchObject({ id: 'id-1', enabled: false })
    await view.unmount()
  })

  it('deleting a server also deletes its keychain secrets', async () => {
    reset([GITHUB])
    const view = await render(<McpSection />)
    await view.getByRole('button', { name: 'Delete github' }).click()
    await vi.waitFor(() => {
      expect(deleteSecret).toHaveBeenCalledWith('mcp:id-1:GITHUB_TOKEN')
      expect(updated.at(-1)?.mcpServers).toEqual([])
    })
    await view.unmount()
  })

  it('adding a server stores its token in the keychain first', async () => {
    reset([])
    const view = await render(<McpSection />)
    await view.getByRole('button', { name: 'Add MCP server' }).click()
    await view.getByLabelText('Server name').fill('GitHub!')
    await view.getByLabelText('Server command').fill('npx -y server-github')
    await view.getByLabelText('Env variable 1 name').fill('GITHUB_TOKEN')
    await view.getByLabelText('Env variable 1 value').fill('tok-123')
    await view.getByRole('button', { name: 'Add server' }).click()

    await vi.waitFor(() => {
      const added = updated.at(-1)?.mcpServers?.[0]
      expect(added).toMatchObject({
        name: 'github',
        transport: { kind: 'stdio', command: 'npx', args: ['-y', 'server-github'] },
        envKeys: ['GITHUB_TOKEN'],
        enabled: true,
      })
      expect(setSecret).toHaveBeenCalledWith(`mcp:${added?.id}:GITHUB_TOKEN`, 'tok-123')
    })
    await view.unmount()
  })
})
