import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { BaseNoteRow } from '@reflect/core'
import type { Route } from '@/routing/route'
import { RouterProvider, useRouter } from '@/routing/router'

const loadBaseRows = vi.hoisted(() => vi.fn<() => Promise<BaseNoteRow[]>>())
const readBaseFile = vi.hoisted(() => vi.fn<(path: string) => Promise<string>>())
const listBaseFiles = vi.hoisted(() => vi.fn<() => Promise<string[]>>())
vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  hasBridge: () => true,
  loadBaseRows,
  readBaseFile,
  listBaseFiles,
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
  readBaseFile.mockReset().mockResolvedValue(BASE)
  listBaseFiles.mockReset().mockResolvedValue(['Home/Projects.base'])
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
  it('renders the first view with its formula column', async () => {
    const view = await renderScreen({ kind: 'base', path: 'Home/Projects.base', view: null })
    await expect.element(view.getByText('Stato')).toBeInTheDocument()
    await expect.element(view.getByText('ACTIVE')).toBeInTheDocument()
    await expect.element(view.getByText('HOLD')).toBeInTheDocument()
  })

  it('switches views from the tabs and opens a note on click', async () => {
    const view = await renderScreen({ kind: 'base', path: 'Home/Projects.base', view: null })
    await view.getByRole('tab', { name: 'Attivi' }).click()
    await expect.element(view.getByText('Captoo')).not.toBeInTheDocument()
    await view.getByText('Kore').click()
    await expect
      .element(view.getByTestId('route'))
      .toHaveTextContent('{"kind":"note","path":"Projects/Kore.md"}')
  })

  it('lists every base when no file is open', async () => {
    const view = await renderScreen({ kind: 'base', path: null, view: null })
    await view.getByText('Projects', { exact: true }).click()
    await expect.element(view.getByTestId('route')).toHaveTextContent('"path":"Home/Projects.base"')
  })
})
