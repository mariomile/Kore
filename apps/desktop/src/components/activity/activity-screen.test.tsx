import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { ActivityCommit, ActivityPage } from '@reflect/core'
import { RouterProvider, useRouter } from '@/routing/router'

const gitActivity = vi.hoisted(() => vi.fn<() => Promise<ActivityPage>>())
const gitNoteHistory = vi.hoisted(() => vi.fn(() => Promise.resolve([])))
vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  hasBridge: () => true,
  gitActivity,
  gitNoteHistory,
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

beforeEach(() => {
  gitActivity.mockReset().mockResolvedValue(PAGE)
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
    await view.getByRole('button', { name: 'Grok bot' }).click()
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
    await expect.element(view.getByRole('status')).toBeVisible()
    await view.getByRole('button', { name: 'Open backup settings' }).click()
    await expect
      .element(view.getByTestId('route'))
      .toHaveTextContent('{"kind":"settings","group":"data"}')
  })
})
