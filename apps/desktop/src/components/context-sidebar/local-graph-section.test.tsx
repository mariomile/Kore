import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { RouterProvider, useRouter } from '@/routing/router'
import { LocalGraphSection } from './local-graph-section'

const getLocalGraph = vi.hoisted(() => vi.fn())
vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  getLocalGraph,
}))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', name: 'g', generation: 1 } }),
}))
vi.mock('@/hooks/use-bridge-ready', () => ({ useBridgeReady: () => true }))

const GRAPH = {
  nodes: [
    { id: 'notes/atlas.md', kind: 'note', title: 'Atlas', dailyDate: null, depth: 0, tag: null },
    { id: 'notes/plan.md', kind: 'note', title: 'Plan', dailyDate: null, depth: 1, tag: 'work' },
  ],
  edges: [{ source: 'notes/plan.md', target: 'notes/atlas.md', weight: 1 }],
  hidden: 3,
}

function RouteProbe(): ReactNode {
  const { route } = useRouter()
  return <output data-testid="route">{JSON.stringify(route)}</output>
}

function tree(client: QueryClient, path: string): ReactNode {
  return (
    <QueryClientProvider client={client}>
      <RouterProvider>
        <div style={{ width: 280 }}>
          <LocalGraphSection path={path} />
        </div>
        <RouteProbe />
      </RouterProvider>
    </QueryClientProvider>
  )
}

let client: QueryClient

function renderSection() {
  return render(tree(client, 'notes/atlas.md'))
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  window.sessionStorage.clear()
  getLocalGraph.mockReset().mockResolvedValue(GRAPH)
})

describe('LocalGraphSection', () => {
  it('maps the neighborhood, switches depth and hands off to the full graph', async () => {
    const view = await renderSection()
    await expect.element(view.getByRole('img', { name: 'Local graph' })).toBeInTheDocument()
    await expect.element(view.getByText('+3 more')).toBeVisible()
    expect(getLocalGraph).toHaveBeenLastCalledWith('notes/atlas.md', { depth: 1, tags: false })

    await userEvent.click(view.getByRole('button', { name: 'Depth 2' }))
    await vi.waitFor(() =>
      expect(getLocalGraph).toHaveBeenLastCalledWith('notes/atlas.md', { depth: 2, tags: false }),
    )

    await userEvent.click(view.getByRole('button', { name: 'Open in Graph' }))
    await expect
      .element(view.getByTestId('route'))
      .toHaveTextContent('{"kind":"graphMap","focus":"notes/atlas.md"}')
    await view.unmount()
  })

  it('never shows the previous note while the next one loads', async () => {
    const view = await renderSection()
    await expect.element(view.getByRole('img', { name: 'Local graph' })).toBeInTheDocument()
    getLocalGraph.mockReturnValue(new Promise(() => {}))
    await view.rerender(tree(client, 'notes/plan.md'))
    await expect.element(view.getByRole('img', { name: 'Local graph' })).not.toBeInTheDocument()
    await view.unmount()
  })

  it('collapsed, it queries nothing', async () => {
    window.sessionStorage.setItem('reflect.context-sidebar.local-graph', 'closed')
    const view = await renderSection()
    await expect.element(view.getByText('Local graph')).toBeVisible()
    expect(getLocalGraph).not.toHaveBeenCalled()
    await view.unmount()
  })
})
