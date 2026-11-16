import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import type { ReactElement } from 'react'
import type { OpenTask } from '@kore/core'
import { RouterProvider, useRouter } from '@/routing/router'
import { TagTasksSection } from './tag-tasks-section'

const data = vi.hoisted(() => ({ rows: [] as OpenTask[], asked: [] as string[] }))
const toggleTask = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('@kore/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kore/core')>()),
  getTasksForTag: async (tag: string) => {
    data.asked.push(tag)
    return data.rows
  },
}))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', generation: 3 } }),
}))
vi.mock('@/hooks/use-bridge-ready', () => ({ useBridgeReady: () => true }))
vi.mock('@/lib/note-task', () => ({ toggleTask }))

function row(overrides: Partial<OpenTask>): OpenTask {
  return {
    notePath: 'daily/2026-11-12.md',
    markerOffset: 0,
    raw: '[ ] task',
    text: 'task',
    breadcrumbs: [],
    checked: false,
    dueDate: null,
    dueTime: null,
    section: null,
    dailyDate: '2026-11-12',
    noteTitle: 'November 12, 2026',
    isPinned: false,
    pinnedOrder: null,
    updatedAt: 0,
    ...overrides,
  }
}

function RouteProbe(): ReactElement {
  const { route } = useRouter()
  return <output data-testid="route">{JSON.stringify(route)}</output>
}

function Subject({ tag }: { tag: string | null }): ReactElement {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider initialRoute={{ kind: 'allNotes', filter: { kind: 'tag', tag: 'lead' } }}>
        <TagTasksSection tag={tag} />
        <RouteProbe />
      </RouterProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  data.rows = []
  data.asked = []
  toggleTask.mockClear()
})

describe('TagTasksSection', () => {
  it('renders nothing when no checkbox carries the tag', async () => {
    const view = await render(<Subject tag="lead" />)
    await expect.poll(() => data.asked).toEqual(['lead'])
    expect(view.getByRole('region').query()).toBeNull()
  })

  it('lists the tagged checkboxes as rows, without the tag itself, with their note', async () => {
    data.rows = [
      row({ text: 'chiamare Andrea #lead', dueDate: '2026-11-14' }),
      row({
        notePath: 'notes/crm.md',
        markerOffset: 9,
        text: 'scrivere a Bea #Lead',
        noteTitle: 'CRM',
      }),
      row({ markerOffset: 30, text: 'mandare la proposta #lead', checked: true }),
    ]
    const view = await render(<Subject tag="lead" />)

    await expect.element(view.getByText('2 open tasks')).toBeInTheDocument()
    await expect.element(view.getByText('chiamare Andrea', { exact: true })).toBeInTheDocument()
    await expect.element(view.getByText('scrivere a Bea', { exact: true })).toBeInTheDocument()
    await expect.element(view.getByText('2026-11-14')).toBeInTheDocument()
    // Done rows wait behind their toggle.
    expect(view.getByText('mandare la proposta').query()).toBeNull()
    await view.getByRole('button', { name: '1 done' }).click()
    await expect.element(view.getByText('mandare la proposta')).toBeInTheDocument()

    await view.getByRole('button', { name: 'CRM' }).click()
    expect(JSON.parse(view.getByTestId('route').element().textContent ?? 'null')).toMatchObject({
      kind: 'note',
      path: 'notes/crm.md',
    })
  })

  it('ticks a row off through the shared task toggle', async () => {
    data.rows = [row({ text: 'chiamare Andrea #lead' })]
    const view = await render(<Subject tag="lead" />)

    await view.getByRole('checkbox', { name: 'Complete task: chiamare Andrea #lead' }).click()

    expect(toggleTask).toHaveBeenCalledWith(
      expect.objectContaining({ notePath: 'daily/2026-11-12.md', markerOffset: 0 }),
      3,
    )
  })
})
