import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setBridge } from '@reflect/core'
import { AgentsSection } from './agents-section'

// A browser-mode module mock materializes value exports once, so this file
// keeps the flag statically true; the off-macOS test lives in
// `agents-section-non-macos.test.tsx`.
vi.mock('@/lib/platform', () => ({ isMacosDesktop: true, isNativeShell: () => true }))

const GRAPH = { root: '/graphs/Personal', name: 'Personal', generation: 7 }
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: GRAPH }),
}))

type InstallState = 'missing' | 'current' | 'stale' | 'conflict'

const SKILL_NAMES = ['reflect-personal', 'kore-markdown', 'kore-collections', 'kore-agent-memory']

let installStates: Record<string, InstallState>
let installCalls: Array<Record<string, unknown>>
let uninstallCalls: Array<Record<string, unknown>>

function setAll(state: InstallState): void {
  installStates = Object.fromEntries(SKILL_NAMES.map((name) => [name, state]))
}

function statusPayload(): Record<string, unknown> {
  return {
    skillsRoot: '/Users/me/.agents/skills',
    cliPath: '/Applications/Kore.app/Contents/MacOS/reflect',
    skills: SKILL_NAMES.map((name) => ({
      skillName: name,
      skillPath: `/Users/me/.agents/skills/${name}/SKILL.md`,
      installState: installStates[name],
    })),
  }
}

function installFakeBridge(): void {
  installCalls = []
  uninstallCalls = []
  setBridge({
    invoke: async (command, args) => {
      switch (command) {
        case 'skill_status':
          return statusPayload()
        case 'skill_install': {
          installCalls.push(args ?? {})
          for (const name of SKILL_NAMES) {
            if (installStates[name] !== 'conflict') {
              installStates[name] = 'current'
            }
          }
          return statusPayload()
        }
        case 'skill_uninstall': {
          uninstallCalls.push(args ?? {})
          for (const name of SKILL_NAMES) {
            if (installStates[name] !== 'conflict') {
              installStates[name] = 'missing'
            }
          }
          return statusPayload()
        }
        default:
          throw new Error(`unexpected command ${command}`)
      }
    },
    listen: async () => () => {},
  })
}

async function renderSection(): Promise<void> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await render(
    <QueryClientProvider client={queryClient}>
      <AgentsSection />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  setAll('missing')
  installFakeBridge()
})

afterEach(() => {
  setBridge(null)
})

describe('AgentsSection', () => {
  it('installs every bundled skill with the graph generation pinned', async () => {
    await renderSection()
    for (const name of SKILL_NAMES) {
      await expect.element(page.getByText(name)).toBeInTheDocument()
    }
    await page.getByRole('button', { name: 'Install skills' }).click()

    expect(installCalls).toEqual([{ generation: GRAPH.generation }])
    await expect.element(page.getByText('/Users/me/.agents/skills')).toBeInTheDocument()
    expect(page.getByRole('button', { name: 'Install skills' }).query()).toBeNull()
    expect(page.getByText('Installed').all()).toHaveLength(SKILL_NAMES.length + 1)
  })

  it('offers an update when one skill is stale and removal for any managed one', async () => {
    setAll('current')
    installStates['kore-collections'] = 'stale'
    await renderSection()

    await expect.element(page.getByText('Update available')).toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: 'Update skills' })).toBeInTheDocument()

    await page.getByRole('button', { name: 'Remove' }).click()
    await expect.element(page.getByRole('button', { name: 'Install skills' })).toBeInTheDocument()
    expect(uninstallCalls).toEqual([{ generation: GRAPH.generation }])
  })

  it('flags an unmanaged file per skill and still installs the others', async () => {
    installStates['kore-markdown'] = 'conflict'
    await renderSection()

    await expect.element(page.getByText(/Kore doesn’t manage/)).toBeInTheDocument()
    await page.getByRole('button', { name: 'Install skills' }).click()

    expect(installCalls).toEqual([{ generation: GRAPH.generation }])
    await expect.element(page.getByText(/Kore doesn’t manage/)).toBeInTheDocument()
    expect(page.getByText('Installed').all()).toHaveLength(SKILL_NAMES.length - 1)
    expect(page.getByRole('button', { name: 'Install skills' }).query()).toBeNull()
  })
})
