import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { ActivityCommit, ActivityPage, Proposal } from '@reflect/core'
import { RouterProvider, useRouter } from '@/routing/router'

const gitActivity = vi.hoisted(() => vi.fn<() => Promise<ActivityPage>>())
const gitNoteHistory = vi.hoisted(() => vi.fn(() => Promise.resolve([])))
const undoSitting = vi.hoisted(() => vi.fn())
const listProposals = vi.hoisted(() => vi.fn<() => Promise<Proposal[]>>())
const acceptProposal = vi.hoisted(() => vi.fn<() => Promise<void>>())
const rejectProposal = vi.hoisted(() => vi.fn<() => Promise<void>>())
vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  hasBridge: () => true,
  gitActivity,
  gitNoteHistory,
  undoSitting,
  listProposals,
  acceptProposal,
  rejectProposal,
}))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', name: 'g', generation: 1 }, indexGeneration: 1 }),
}))
vi.mock('@/providers/settings-provider', async () => {
  const { DEFAULT_SETTINGS } = await import('@reflect/core')
  return {
    useSettings: () => ({ settings: DEFAULT_SETTINGS, updateSettings: () => {} }),
  }
})

const { ActivityScreen } = await import('./activity-screen')

const MINUTE = 60 * 1000
const NOW = new Date('2026-11-08T18:00:00').getTime()

function commit(
  id: string,
  minutesAgo: number,
  author: string,
  path: string,
  agent?: string,
): ActivityCommit {
  return {
    commit: id,
    timeMs: NOW - minutesAgo * MINUTE,
    authorName: author,
    authorEmail: '',
    summary: 'Update notes',
    trailers: agent === undefined ? [] : [{ key: 'Kore-Agent', value: agent }],
    files: [{ path, kind: 'modified' }],
  }
}

const PAGE: ActivityPage = {
  commits: [
    commit('c3', 0, 'Mario', 'notes/Plan.md'),
    commit('c2', 10, 'Grok bot', 'notes/Inbox.md', 'Grok bot'),
    commit('c1', 15, 'Grok bot', 'notes/Ideas.md', 'Grok bot'),
  ],
  next: null,
}

function RouteProbe(): ReactNode {
  const { route } = useRouter()
  return <output data-testid="route">{JSON.stringify(route)}</output>
}

const EDIT: Proposal = {
  id: '1762621200000-abc',
  at: NOW,
  agent: { name: 'Grok bot', email: 'grok-bot@agents.kore' },
  call: { tool: 'edit_note', arguments: { note: 'Atlas', oldText: 'draft', newText: 'final' } },
}

beforeEach(() => {
  gitActivity.mockReset().mockResolvedValue(PAGE)
  undoSitting.mockReset()
  listProposals.mockReset().mockResolvedValue([])
  acceptProposal.mockReset().mockResolvedValue(undefined)
  rejectProposal.mockReset().mockResolvedValue(undefined)
})

async function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return await render(
    <QueryClientProvider client={client}>
      <RouterProvider initialRoute={{ kind: 'activity' }}>
        <ActivityScreen />
        <RouteProbe />
      </RouterProvider>
    </QueryClientProvider>,
  )
}

describe('ActivityScreen', () => {
  it('lists sittings by author with the notes each one touched', async () => {
    const view = await renderScreen()
    await expect.element(view.getByText('Grok bot', { exact: true }).first()).toBeVisible()
    await expect.element(view.getByText('You', { exact: true }).first()).toBeVisible()
    await expect.element(view.getByText('Inbox')).toBeVisible()
    await expect.element(view.getByText('Ideas')).toBeVisible()
    await expect.element(view.getByText('2 notes')).toBeVisible()
  })

  it('filters to one author', async () => {
    const view = await renderScreen()
    await view.getByRole('button', { name: 'Grok bot', exact: true }).click()
    await expect.element(view.getByText('Inbox')).toBeVisible()
    await expect.element(view.getByText('Plan')).not.toBeInTheDocument()
  })

  it('opens a note’s history from its row', async () => {
    const view = await renderScreen()
    await view.getByText('Inbox').click()
    await vi.waitFor(() => expect(gitNoteHistory).toHaveBeenCalledWith('notes/Inbox.md', 1))
  })

  it('points at backup settings when there is no history to read', async () => {
    gitActivity.mockRejectedValue(new Error('no repository'))
    const view = await renderScreen()
    await expect.element(view.getByText(/read from the vault’s backup history/)).toBeVisible()
    await view.getByRole('button', { name: 'Open backup settings' }).click()
    await expect
      .element(view.getByTestId('route'))
      .toHaveTextContent('{"kind":"settings","group":"data"}')
  })

  it('undoes a sitting after confirming', async () => {
    undoSitting.mockResolvedValue({ kind: 'undone', notes: ['notes/Inbox.md'] })
    const view = await renderScreen()
    await view.getByRole('button', { name: 'Undo Grok bot’s changes' }).click()
    await expect.element(view.getByText('Undo Grok bot’s changes?')).toBeVisible()
    await view.getByRole('button', { name: 'Undo', exact: true }).click()
    await vi.waitFor(() =>
      expect(undoSitting).toHaveBeenCalledWith(
        expect.objectContaining({ commits: ['c2', 'c1'] }),
        1,
        expect.anything(),
      ),
    )
  })

  it('names the notes that block an undo and writes nothing', async () => {
    undoSitting.mockResolvedValue({
      kind: 'conflict',
      conflicts: [{ path: 'notes/Inbox.md', reason: 'changedSince' }],
    })
    const view = await renderScreen()
    await view.getByRole('button', { name: 'Undo Grok bot’s changes' }).click()
    await view.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect.element(view.getByText(/Nothing was undone/)).toBeVisible()
    await expect.element(view.getByText('edited again since')).toBeVisible()
  })

  it('shows what a proposing agent wants to change and accepts it', async () => {
    listProposals.mockResolvedValueOnce([EDIT]).mockResolvedValue([])
    const view = await renderScreen()
    const row = view.getByRole('listitem', { name: 'Grok bot: Edit Atlas' })
    await expect.element(row).toBeVisible()
    await expect.element(row.getByText('draft')).toBeVisible()
    await expect.element(row.getByText('final')).toBeVisible()
    await row.getByRole('button', { name: 'Accept' }).click()
    await vi.waitFor(() => expect(acceptProposal).toHaveBeenCalledWith(1, EDIT.id))
    await expect.element(view.getByText('Waiting for you')).not.toBeInTheDocument()
  })

  it('keeps a proposal whose write failed and says why', async () => {
    listProposals.mockResolvedValue([EDIT])
    acceptProposal.mockRejectedValue(new Error('the passage is not in the note any more'))
    const view = await renderScreen()
    await view.getByRole('button', { name: 'Accept' }).click()
    await expect.element(view.getByText('the passage is not in the note any more')).toBeVisible()
    await expect.element(view.getByText('Waiting for you')).toBeVisible()
  })

  it('rejects a proposal even before backup is on', async () => {
    gitActivity.mockRejectedValue(new Error('no repository'))
    listProposals.mockResolvedValueOnce([EDIT]).mockResolvedValue([])
    const view = await renderScreen()
    await view.getByRole('button', { name: 'Reject' }).click()
    await vi.waitFor(() => expect(rejectProposal).toHaveBeenCalledWith(1, EDIT.id))
    await expect.element(view.getByText(/read from the vault’s backup history/)).toBeVisible()
  })
})
