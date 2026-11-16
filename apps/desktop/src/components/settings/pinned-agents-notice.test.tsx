import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setBridge } from '@kore/core'
import { PinnedAgentsNotice } from './pinned-agents-notice'

vi.mock('@/lib/platform', () => ({ isMacosDesktop: true, isNativeShell: () => true }))
vi.mock('@/hooks/use-bridge-ready', () => ({ useBridgeReady: () => true }))

const KORE = '/Applications/Kore.app/Contents/MacOS/kore'

function bridge(skillState: 'current' | 'missing'): void {
  setBridge({
    invoke: async (command) => {
      switch (command) {
        case 'mcp_client_servers':
          return [
            {
              client: 'Claude Desktop',
              name: 'kore',
              command: KORE,
              args: ['--graph', '/v/Brain', 'mcp'],
              env: {},
            },
            { client: 'Cursor', name: 'kore', command: KORE, args: ['mcp'], env: {} },
          ]
        case 'skill_status':
          return {
            skillsRoot: '/Users/me/.agents/skills',
            cliPath: KORE,
            skills: [
              { skillName: 'kore-graph-brain', skillPath: '/s/SKILL.md', installState: skillState },
            ],
          }
        default:
          throw new Error(`unexpected command ${command}`)
      }
    },
    listen: async () => () => {},
  })
}

async function renderNotice(root: string): Promise<void> {
  await render(
    <QueryClientProvider client={new QueryClient()}>
      <PinnedAgentsNotice root={root} enabled />
    </QueryClientProvider>,
  )
}

describe('PinnedAgentsNotice', () => {
  afterEach(() => setBridge(null))

  it('names the agents tied to the folder being moved and where to refresh them', async () => {
    bridge('current')
    await renderNotice('/v/Brain')
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(
        'Claude Desktop and the vault skill point to this folder and would keep using the copy left here.',
      )
    await expect.element(page.getByRole('alert')).toHaveTextContent('and update the skills there.')
  })

  it('stays hidden when no agent is tied to the folder', async () => {
    bridge('missing')
    await renderNotice('/v/Other')
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(page.getByRole('alert').query()).toBeNull()
  })
})
