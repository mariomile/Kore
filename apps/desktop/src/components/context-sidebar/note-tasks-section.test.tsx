import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import type { ReactElement } from 'react'
import type { NoteTaskRef } from '@reflect/core'
import { RouterProvider, useRouter } from '@/routing/router'
import { NoteTasksSection } from './note-tasks-section'

const data = vi.hoisted(() => ({ tasks: [] as NoteTaskRef[] }))
const toggleTask = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  getOpenTasksForNote: async () => data.tasks,
}))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', generation: 3 } }),
}))
vi.mock('@/hooks/use-bridge-ready', () => ({ useBridgeReady: () => true }))
vi.mock('@/lib/note-task', () => ({ toggleTask }))

function taskRow(overrides: Partial<NoteTaskRef>): NoteTaskRef {
  return {
    notePath: 'notes/casa-nuova.md',
    markerOffset: 0,
    raw: '[ ] task',
    text: 'task',
    breadcrumbs: [],
    checked: false,
    dueDate: null,
    dueTime: null,
    dailyDate: null,
    noteTitle: 'Casa Nuova',
    isPinned: false,
    pinnedOrder: null,
    updatedAt: 0,
    linked: false,
    ...overrides,
  }
}

function RouteProbe(): ReactElement {
  const { route } = useRouter()
  return <output data-testid="route">{JSON.stringify(route)}</output>
}

function Subject(): ReactElement {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider initialRoute={{ kind: 'note', path: 'notes/casa-nuova.md' }}>
        <NoteTasksSection path="notes/casa-nuova.md" />
        <RouteProbe />
      </RouterProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  data.tasks = []
  toggleTask.mockClear()
})

describe('NoteTasksSection', () => {
  it('renders nothing while the note has no open tasks', async () => {
    const view = await render(<Subject />)
    await expect.poll(() => view.getByText('Tasks').query()).toBeNull()
  })

  it('lists own tasks plainly and linked tasks with their source note', async () => {
    data.tasks = [
      taskRow({ text: 'own task in the note' }),
      taskRow({
        notePath: 'daily/2026-08-30.md',
        markerOffset: 10,
        text: 'chiama il geometra Casa Nuova',
        noteTitle: 'August 30, 2026',
        dueDate: '2026-09-01',
        linked: true,
      }),
    ]
    const view = await render(<Subject />)

    await expect.element(view.getByText('own task in the note')).toBeInTheDocument()
    await expect.element(view.getByText('chiama il geometra Casa Nuova')).toBeInTheDocument()
    await expect.element(view.getByText('2026-09-01')).toBeInTheDocument()

    // The linked row names its source; clicking it jumps there.
    await view.getByRole('button', { name: 'August 30, 2026' }).click()
    expect(JSON.parse(view.getByTestId('route').element().textContent ?? 'null')).toEqual({
      kind: 'daily',
      date: '2026-08-30',
    })
  })

  it('completes a task through the shared toggle commit', async () => {
    data.tasks = [taskRow({ text: 'own task in the note' })]
    const view = await render(<Subject />)

    await view.getByRole('button', { name: 'Complete task: own task in the note' }).click()

    expect(toggleTask).toHaveBeenCalledTimes(1)
    expect(toggleTask).toHaveBeenCalledWith(
      expect.objectContaining({ notePath: 'notes/casa-nuova.md', markerOffset: 0 }),
      3,
    )
  })
})
