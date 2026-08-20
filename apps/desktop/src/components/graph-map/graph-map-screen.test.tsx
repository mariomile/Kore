import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { RouterProvider } from '@/routing/router'

const getGraphMap = vi.hoisted(() => vi.fn())
vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  getGraphMap,
}))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', name: 'g', generation: 1 }, indexing: false }),
}))
vi.mock('@/hooks/use-bridge-ready', () => ({ useBridgeReady: () => true }))

const { GraphMapScreen } = await import('./graph-map-screen')

const MAP = {
  nodes: [
    { path: 'notes/atlas.md', title: 'Atlas', dailyDate: null, inbound: 2 },
    { path: 'notes/weekly.md', title: 'Weekly', dailyDate: null, inbound: 0 },
    { path: 'daily/2026-08-20.md', title: '', dailyDate: '2026-08-20', inbound: 0 },
  ],
  edges: [
    { source: 'notes/weekly.md', target: 'notes/atlas.md', weight: 2 },
    { source: 'daily/2026-08-20.md', target: 'notes/atlas.md', weight: 1 },
  ],
}

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider initialRoute={{ kind: 'graphMap' }}>
        <div style={{ width: 800, height: 600 }}>
          <GraphMapScreen />
        </div>
      </RouterProvider>
    </QueryClientProvider>,
  )
}

describe('GraphMapScreen', () => {
  it('hides daily notes by default and brings them in with the toggle', async () => {
    getGraphMap.mockResolvedValue(MAP)
    const view = await renderScreen()

    // Dailies (and their edges) are filtered out of the default map.
    await expect.element(view.getByText('2 notes · 1 links')).toBeVisible()
    await expect.element(view.getByRole('img', { name: 'Note graph' })).toBeInTheDocument()

    await view.getByRole('checkbox', { name: 'Daily notes' }).click()
    await expect.element(view.getByText('3 notes · 2 links')).toBeVisible()
    await view.unmount()
  })

  it('shows the empty state for a graph with nothing to map', async () => {
    getGraphMap.mockResolvedValue({ nodes: [], edges: [] })
    const view = await renderScreen()
    await expect.element(view.getByText(/Nothing to map yet/)).toBeVisible()
    await view.unmount()
  })
})
