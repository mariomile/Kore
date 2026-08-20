import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { Settings } from '@reflect/core'
import { RouterProvider, useRouter } from '@/routing/router'
import { AgentsScreen } from './agents-screen'

const listAgentProfiles = vi.hoisted(() => vi.fn())
const createAgentProfile = vi.hoisted(() => vi.fn())
const ensureUserMemoryNote = vi.hoisted(() => vi.fn(async () => {}))
const ensureSharedMemoryNotes = vi.hoisted(() => vi.fn(async () => {}))
const deleteNote = vi.hoisted(() => vi.fn(async () => {}))
const readNote = vi.hoisted(() => vi.fn<(path: string) => Promise<string>>())
const writeNote = vi.hoisted(() =>
  vi.fn<(path: string, contents: string, generation: number) => Promise<void>>(async () => {}),
)
vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  listAgentProfiles,
  createAgentProfile,
  ensureUserMemoryNote,
  ensureSharedMemoryNotes,
  deleteNote,
  readNote,
  writeNote,
}))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', name: 'g', generation: 7 } }),
}))
const settingsState = vi.hoisted(() => ({
  activeAgentProfile: null as string | null,
  aiProviders: [] as { id: string; provider: string }[],
  memoryWriteApproval: false,
}))
const updatedSettings = vi.hoisted(() => [] as Partial<Settings>[])
vi.mock('@/providers/settings-provider', () => ({
  useSettings: () => ({
    settings: {
      activeAgentProfile: settingsState.activeAgentProfile,
      aiProviders: settingsState.aiProviders,
      memoryWriteApproval: settingsState.memoryWriteApproval,
      agentRoutines: [],
    },
    updateSettings: (patch: Partial<Settings>) => {
      updatedSettings.push(patch)
    },
    updateSettingsWith: (updater: (current: { agentRoutines: [] }) => Partial<Settings>) => {
      updatedSettings.push(updater({ agentRoutines: [] }))
    },
  }),
}))

const RILEY = {
  slug: 'riley',
  name: 'Riley',
  provider: 'codex-cli',
  model: null,
  soulPath: 'agents/riley/soul.md',
  memoryPath: 'agents/riley/memory.md',
}

function RouteProbe(): ReactNode {
  const { route } = useRouter()
  return <output data-testid="route">{JSON.stringify(route)}</output>
}

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider>
        <AgentsScreen />
        <RouteProbe />
      </RouterProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  settingsState.activeAgentProfile = null
  settingsState.aiProviders = []
  settingsState.memoryWriteApproval = false
  updatedSettings.length = 0
  listAgentProfiles.mockReset().mockResolvedValue([RILEY])
  createAgentProfile.mockReset()
  ensureUserMemoryNote.mockClear()
  ensureSharedMemoryNotes.mockClear()
  deleteNote.mockClear()
  readNote.mockReset().mockRejectedValue(new Error('missing'))
  writeNote.mockClear()
})

describe('AgentsScreen', () => {
  it('lists profiles with their provider pin and the no-agent row active', async () => {
    const view = await renderScreen()
    await expect.element(view.getByText('Riley', { exact: true })).toBeVisible()
    await expect.element(view.getByText(/agents\/riley · Codex/)).toBeVisible()
    await expect
      .element(view.getByRole('button', { name: /No agent/ }))
      .toHaveAttribute('aria-pressed', 'true')
    await view.unmount()
  })

  it('Use activates the profile and steers chat to its configured provider', async () => {
    settingsState.aiProviders = [{ id: 'p1', provider: 'codex-cli' }]
    const view = await renderScreen()
    await view.getByRole('button', { name: 'Use' }).click()
    expect(updatedSettings).toContainEqual({ activeAgentProfile: 'riley' })
    expect(updatedSettings).toContainEqual({
      chatModelSelection: { configId: 'p1', modelId: 'default' },
    })
    await view.unmount()
  })

  it('creates a new agent and opens its soul for editing', async () => {
    createAgentProfile.mockResolvedValue({ ...RILEY, slug: 'coach', name: 'Coach' })
    const view = await renderScreen()
    await view.getByRole('button', { name: 'New agent' }).click()
    await userEvent.type(view.getByLabelText('Agent name'), 'Coach')
    await view.getByRole('button', { name: 'Create agent' }).click()
    expect(createAgentProfile).toHaveBeenCalledWith({
      name: 'Coach',
      provider: null,
      generation: 7,
    })
    await expect
      .element(view.getByTestId('route'))
      .toHaveTextContent('"path":"agents/riley/soul.md"')
    await view.unmount()
  })

  it('About you seeds and opens the shared user profile', async () => {
    const view = await renderScreen()
    await view.getByRole('button', { name: 'Open' }).click()
    expect(ensureUserMemoryNote).toHaveBeenCalledWith(7)
    await expect.element(view.getByTestId('route')).toHaveTextContent('"path":"agents/user.md"')
    await view.unmount()
  })

  it('approving a pending proposal appends to its target and clears it', async () => {
    const pendingSource = [
      '## 2026-08-20 riley → agents/user.md',
      '- Prefers commit messages in English',
      '',
    ].join('\n')
    readNote.mockImplementation(async (path: string) => {
      if (path === 'agents/memory/pending.md') return pendingSource
      if (path === 'agents/user.md') return '# About you\n\n- Existing fact\n'
      throw new Error('missing')
    })
    const view = await renderScreen()
    await expect.element(view.getByText('Prefers commit messages in English')).toBeVisible()
    await view.getByRole('button', { name: 'Approve' }).click()
    await expect.poll(() => writeNote.mock.calls.length).toBe(2)
    expect(writeNote).toHaveBeenCalledWith(
      'agents/user.md',
      '# About you\n\n- Existing fact\n- Prefers commit messages in English\n',
      7,
    )
    const pendingWrite = writeNote.mock.calls.find((call) => call[0] === 'agents/memory/pending.md')
    expect(pendingWrite?.[1]).not.toContain('Prefers commit messages')
    await view.unmount()
  })

  it('the approval switch patches the setting and Facts opens the shared note', async () => {
    const view = await renderScreen()
    await view.getByLabelText('Approve memory writes').click()
    expect(updatedSettings).toContainEqual({ memoryWriteApproval: true })
    await view.getByRole('button', { name: 'Facts' }).click()
    expect(ensureSharedMemoryNotes).toHaveBeenCalledWith(7)
    await expect
      .element(view.getByTestId('route'))
      .toHaveTextContent('"path":"agents/memory/facts.md"')
    await view.unmount()
  })

  it('deleting a profile trashes both files and clears the active slug', async () => {
    settingsState.activeAgentProfile = 'riley'
    const view = await renderScreen()
    await view.getByRole('button', { name: 'Delete Riley' }).click()
    expect(deleteNote).toHaveBeenCalledWith('agents/riley/soul.md', 7)
    expect(deleteNote).toHaveBeenCalledWith('agents/riley/memory.md', 7)
    expect(updatedSettings).toContainEqual({ activeAgentProfile: null })
    await view.unmount()
  })
})
