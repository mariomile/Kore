import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { GraphInsights } from '@reflect/core'
import { RouterProvider, useRouter } from '@/routing/router'

const loadGraphInsights = vi.hoisted(() => vi.fn<() => Promise<GraphInsights>>())
vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  hasBridge: () => true,
  loadGraphInsights,
}))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', name: 'g', generation: 1 } }),
}))
vi.mock('@/providers/settings-provider', async () => {
  const { DEFAULT_SETTINGS } = await import('@reflect/core')
  return {
    useSettings: () => ({ settings: DEFAULT_SETTINGS, updateSettings: () => {} }),
  }
})

const { InsightsScreen } = await import('./insights-screen')

const INSIGHTS: GraphInsights = {
  noteCount: 42,
  dailyNoteCount: 120,
  openTaskCount: 7,
  completedTaskCount: 55,
  tagCount: 9,
  mostLinked: [
    { path: 'notes/atlas.md', title: 'Project Atlas', dailyDate: null, backlinks: 12 },
    { path: 'daily/2026-06-01.md', title: '2026-06-01', dailyDate: '2026-06-01', backlinks: 3 },
  ],
  activity: [{ date: '2026-06-10', edited: 4 }],
  topTags: [
    { tag: 'book', count: 8 },
    { tag: 'person', count: 2 },
  ],
}

function RouteProbe(): ReactNode {
  const { route } = useRouter()
  return <output data-testid="route">{JSON.stringify(route)}</output>
}

beforeEach(() => {
  loadGraphInsights.mockReset().mockResolvedValue(INSIGHTS)
})

async function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return await render(
    <QueryClientProvider client={client}>
      <RouterProvider initialRoute={{ kind: 'insights' }}>
        <InsightsScreen />
        <RouteProbe />
      </RouterProvider>
    </QueryClientProvider>,
  )
}

describe('InsightsScreen', () => {
  it('renders headline counts, linked notes, and top tags', async () => {
    const view = await renderScreen()
    await expect.element(view.getByText('42')).toBeInTheDocument()
    await expect.element(view.getByText('Daily notes')).toBeInTheDocument()
    await expect.element(view.getByText('Project Atlas')).toBeInTheDocument()
    await expect.element(view.getByText('12 links')).toBeInTheDocument()
    await expect.element(view.getByText('#book')).toBeInTheDocument()
  })

  it('opens a most-linked note on click', async () => {
    const view = await renderScreen()
    await view.getByText('Project Atlas').click()
    await expect
      .element(view.getByTestId('route'))
      .toHaveTextContent('{"kind":"note","path":"notes/atlas.md"}')
  })

  it('opens the tag-filtered All Notes view from a top tag', async () => {
    const view = await renderScreen()
    await view.getByText('#book').click()
    await expect
      .element(view.getByTestId('route'))
      .toHaveTextContent('{"kind":"allNotes","tag":"book"}')
  })

  it('surfaces a failed load as an alert', async () => {
    loadGraphInsights.mockRejectedValue(new Error('index unavailable'))
    const view = await renderScreen()
    await expect.element(view.getByRole('alert')).toBeInTheDocument()
  })
})
