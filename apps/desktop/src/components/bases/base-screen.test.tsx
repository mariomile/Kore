import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { BaseNoteRow } from '@kore/core'
import type { Route } from '@/routing/route'
import { RouterProvider, useRouter } from '@/routing/router'

const loadBaseRows = vi.hoisted(() => vi.fn<() => Promise<BaseNoteRow[]>>())
const file = vi.hoisted(() => ({ text: '' }))
const readBaseFile = vi.hoisted(() => vi.fn<(path: string) => Promise<string>>())
const updateBaseFile = vi.hoisted(() =>
  vi.fn(async (_path: string, _generation: number, change: (text: string) => string) => {
    file.text = change(file.text)
    return file.text
  }),
)
const listBaseFiles = vi.hoisted(() => vi.fn<() => Promise<string[]>>())
const createBaseNote = vi.hoisted(() => vi.fn(async () => 'notes/new.md'))
vi.mock('@kore/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kore/core')>()),
  hasBridge: () => true,
  loadBaseRows,
  readBaseFile,
  updateBaseFile,
  listBaseFiles,
  createBaseNote,
}))
const commitProperty = vi.hoisted(() =>
  vi.fn<(path: string, key: string, value: unknown) => void>(),
)
vi.mock('@/lib/tags/use-commit-note-property', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tags/use-commit-note-property')>()),
  useCommitNoteProperty: () => commitProperty,
  useCommitNoteProperties: () => () => {},
  invalidateOnNextIndexApply: () => {},
}))
vi.mock('@/providers/settings-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/providers/settings-provider')>()),
  useSettings: () => ({
    settings: { uiDensity: 'default', dateFormat: 'mdy', timeFormat: '12h' },
    updateSettings: () => {},
  }),
}))
vi.mock('@/lib/tags/use-open-relation', () => ({ useOpenRelation: () => () => {} }))
vi.mock('@/hooks/use-open-task-counts', () => ({ useOpenTaskCounts: () => ({}) }))
vi.mock('@/lib/haptics', () => ({ haptic: () => {} }))
const toastAdd = vi.hoisted(() => vi.fn((_toast: { title?: string }) => 'toast-id'))
vi.mock('@/components/ui/toast', () => ({ toast: { add: toastAdd, close: () => {} } }))
const mobile = vi.hoisted(() => ({ on: false }))
vi.mock('@/lib/platform-surface', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/platform-surface')>()),
  isMobileSurface: () => mobile.on,
}))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', name: 'g', generation: 1 } }),
}))

const { BaseScreen } = await import('./base-screen')

function note(path: string, properties: BaseNoteRow['properties']): BaseNoteRow {
  return {
    path,
    title: (path.split('/').at(-1) ?? path).replace(/\.md$/, ''),
    mtime: Date.now(),
    ctime: Date.now(),
    size: 100,
    tags: ['type/project'],
    properties,
    links: [],
    backlinks: [],
  }
}

const BASE = `
filters: file.hasTag("type/project")
formulas:
  label: status.upper()
properties:
  formula.label:
    displayName: Stato
views:
  - type: table
    name: Tutti
    order: [file.name, formula.label]
  - type: table
    name: Attivi
    filters: status == "active"
    order: [file.name]
  - type: table
    name: Modifica
    order: [file.name, status, formula.label]
  - type: list
    name: Lista
    filters:
      or:
        - status == "active"
        - status == "hold"
    order: [file.name]
  - type: kanban
    name: Board
    order: [file.name]
    groupBy:
      property: status
      direction: ASC
`

function RouteProbe(): ReactNode {
  const { route } = useRouter()
  return <output data-testid="route">{JSON.stringify(route)}</output>
}

function Screen(): ReactNode {
  const { route } = useRouter()
  return route.kind === 'base' ? <BaseScreen path={route.path} view={route.view} /> : null
}

beforeEach(() => {
  loadBaseRows
    .mockReset()
    .mockResolvedValue([
      note('Projects/Kore.md', { status: 'active' }),
      note('Projects/Captoo.md', { status: 'hold' }),
    ])
  file.text = BASE
  readBaseFile.mockReset().mockImplementation(async () => file.text)
  updateBaseFile.mockClear()
  listBaseFiles.mockReset().mockResolvedValue(['Home/Projects.base'])
  commitProperty.mockReset()
  createBaseNote.mockClear()
  toastAdd.mockClear()
  mobile.on = false
})

async function renderScreen(initialRoute: Route) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return await render(
    <QueryClientProvider client={client}>
      <RouterProvider initialRoute={initialRoute}>
        <Screen />
        <RouteProbe />
      </RouterProvider>
    </QueryClientProvider>,
  )
}

describe('BaseScreen', () => {
  it('shows the first view as a table with its formula column', async () => {
    const view = await renderScreen({ kind: 'base', path: 'Home/Projects.base', view: null })
    await expect
      .element(view.getByRole('heading', { name: 'Projects', level: 1 }))
      .toBeInTheDocument()
    await expect.element(view.getByText('ACTIVE')).toBeInTheDocument()
    await expect.element(view.getByText('HOLD')).toBeInTheDocument()
    await expect
      .element(view.getByRole('tab', { name: /Tutti/ }))
      .toHaveAttribute('aria-selected', 'true')
  })

  it('switches views from the tabs, listing what the base engine lists', async () => {
    const view = await renderScreen({ kind: 'base', path: 'Home/Projects.base', view: null })
    await view.getByRole('tab', { name: /Attivi/ }).click()
    await expect.element(view.getByTestId('route')).toHaveTextContent('"view":"Attivi"')
    await expect.element(view.getByText('Kore', { exact: true })).toBeInTheDocument()
    await expect.element(view.getByText('Captoo', { exact: true })).not.toBeInTheDocument()
  })

  it('writes a hidden column into the base file and drops it at once', async () => {
    const view = await renderScreen({ kind: 'base', path: 'Home/Projects.base', view: null })
    await expect.element(view.getByText('ACTIVE')).toBeInTheDocument()
    await view.getByRole('button', { name: 'Columns' }).click()
    await view.getByRole('menuitemcheckbox', { name: 'Stato' }).click()
    await expect.element(view.getByText('ACTIVE')).not.toBeInTheDocument()
    expect(updateBaseFile).toHaveBeenCalledOnce()
    expect(file.text).toContain('order:\n      - file.name\n')
    expect(file.text).toContain('formulas:\n  label: status.upper()')
  })

  it('adds a view to the base file from the current one and opens it', async () => {
    const view = await renderScreen({ kind: 'base', path: 'Home/Projects.base', view: 'Attivi' })
    await view.getByRole('button', { name: 'Add a view' }).click()
    await view.getByRole('menuitem', { name: /Grid/ }).click()
    await expect.element(view.getByTestId('route')).toHaveTextContent('"view":"Cards"')
    expect(file.text).toMatch(/- type: cards\n\s+name: Cards/)
    await expect.element(view.getByRole('tab', { name: /Cards/ })).toBeInTheDocument()
  })

  it('lanes a board view by its grouping and creates a lane note with the view prefill', async () => {
    const view = await renderScreen({ kind: 'base', path: 'Home/Projects.base', view: 'Board' })
    await expect.element(view.getByRole('region', { name: 'hold' })).toBeInTheDocument()
    await view.getByRole('button', { name: 'New note in hold' }).click()
    await expect
      .poll(() => createBaseNote.mock.calls.at(0) as unknown[] | undefined)
      .toEqual([
        'Untitled',
        { folder: null, properties: { status: 'hold' }, tags: ['type/project'] },
        1,
      ])
  })

  it('names the base in the bar on iPhone, whose back goes to every base on a cold entry', async () => {
    mobile.on = true
    const view = await renderScreen({ kind: 'base', path: 'Home/Projects.base', view: null })
    await expect
      .element(view.getByRole('heading', { name: 'Projects', level: 1 }))
      .toBeInTheDocument()
    await expect.element(view.getByRole('button', { name: 'View: Tutti' })).toBeInTheDocument()
    await view.getByRole('button', { name: 'Back' }).click()
    await expect
      .element(view.getByTestId('route'))
      .toHaveTextContent('{"kind":"base","path":null,"view":null}')
  })

  it('picks another view from the views sheet on iPhone', async () => {
    mobile.on = true
    const view = await renderScreen({ kind: 'base', path: 'Home/Projects.base', view: null })
    await view.getByRole('button', { name: 'View: Tutti' }).click()
    await view.getByText('Attivi', { exact: true }).click()
    await expect.element(view.getByTestId('route')).toHaveTextContent('"view":"Attivi"')
  })

  it('lists every base when no file is open', async () => {
    const view = await renderScreen({ kind: 'base', path: null, view: null })
    await view.getByText('Projects', { exact: true }).click()
    await expect.element(view.getByTestId('route')).toHaveTextContent('"path":"Home/Projects.base"')
  })
})
