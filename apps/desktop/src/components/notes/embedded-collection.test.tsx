import { describe, expect, it, vi } from 'vitest'
import { render as renderBare } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import type { CollectionEntry, TagType } from '@reflect/core'
import { EmbeddedCollection } from './embedded-collection'

const useReusableCollection = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/use-reusable-collection', () => ({ useReusableCollection }))

/** The widget reads the query client for its schema edits; the rest is mocked. */
function render(element: ReactElement): ReturnType<typeof renderBare> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderBare(<QueryClientProvider client={client}>{element}</QueryClientProvider>)
}

const BOOK_TYPE: TagType = {
  properties: [
    { name: 'Author', key: 'author', type: 'text' },
    { name: 'Status', key: 'status', type: 'select', options: ['reading', 'done'] },
  ],
}

const ENTRIES: CollectionEntry[] = [
  {
    path: 'notes/dune.md',
    title: 'Dune',
    mtime: 1,
    isPinned: false,
    properties: {
      author: { value: 'Herbert', valueType: 'string', valueNumber: null },
      status: { value: 'reading', valueType: 'string', valueNumber: null },
    },
  },
  {
    path: 'notes/dispossessed.md',
    title: 'The Dispossessed',
    mtime: 2,
    isPinned: false,
    properties: {
      author: { value: 'Le Guin', valueType: 'string', valueNumber: null },
    },
  },
]

useReusableCollection.mockReturnValue({
  status: 'resolved',
  definition: {
    id: '01COLLECTION',
    path: 'notes/library.md',
    title: 'Library',
    config: {
      version: 1,
      sources: { tags: ['book'], include: [], exclude: [] },
    },
  },
  rows: ENTRIES,
  schema: {
    type: BOOK_TYPE,
    fields: BOOK_TYPE.properties.map((property) => ({
      key: property.key,
      property,
      declaredBy: ['book'],
      valueTypes: ['string'],
      editable: true,
      conflict: null,
    })),
  },
  diagnostics: [],
  notes: ENTRIES.map((entry) => ({ ...entry, snippet: '', tags: ['book'] })),
})

vi.mock('@/hooks/use-tag-type', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/use-tag-type')>()),
  useTagType: () => BOOK_TYPE,
}))
vi.mock('@/hooks/use-collection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/use-collection')>()),
  useCollection: () => ENTRIES,
}))
vi.mock('@/hooks/use-note-link-navigation', () => ({
  useNoteLinkNavigation: () => vi.fn(),
}))
vi.mock('@/routing/router', () => ({
  useRouter: () => ({ navigate: vi.fn() }),
  useNavigationRevision: () => 0,
}))
vi.mock('@/providers/settings-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/providers/settings-provider')>()),
  useSettings: () => ({
    settings: {
      uiDensity: 'default',
      dateFormat: 'mdy',
      timeFormat: '12h',
      weekStartDay: 'sunday',
    },
    updateSettings: vi.fn(),
  }),
}))
vi.mock('@/lib/tags/use-commit-note-property', () => ({
  useCommitNoteProperty: () => vi.fn(),
  useCommitNoteProperties: () => vi.fn(),
}))
vi.mock('@/lib/tags/use-open-relation', () => ({
  useOpenRelation: () => vi.fn(),
}))
vi.mock('@/hooks/use-open-task-counts', () => ({
  useOpenTaskCounts: () => ({}),
}))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', name: 'g', generation: 1 } }),
}))

describe('EmbeddedCollection', () => {
  it('renders a named collection, keeps hidden fields filterable, and persists sorting', async () => {
    const onChange = vi.fn()
    const embed = {
      selection: { kind: 'definition' as const, reference: '01COLLECTION' },
      view: 'table' as const,
      sorts: [],
      group: null,
      filters: [{ key: 'author', operator: 'is' as const, text: 'Herbert' }],
      match: 'all' as const,
      hidden: ['author'],
    }
    const view = await render(<EmbeddedCollection embed={embed} onChange={onChange} />)

    await expect.element(view.getByText('Library')).toBeInTheDocument()
    await expect.element(view.getByText('Dune')).toBeInTheDocument()
    expect(view.getByText('The Dispossessed').query()).toBeNull()
    expect(view.getByRole('button', { name: /Sort by Author/ }).query()).toBeNull()

    await view.getByRole('button', { name: /Sort by Title/ }).click()
    expect(onChange).toHaveBeenCalledWith({
      ...embed,
      sorts: [{ key: '$title', direction: 'asc' }],
    })

    await view.getByRole('combobox', { name: 'Collection view' }).click()
    await view.getByRole('option', { name: 'Board', exact: true }).click()
    expect(onChange).toHaveBeenCalledWith({ ...embed, view: 'board', group: 'author' })
  })

  it('shows an unresolved named reference instead of an empty collection', async () => {
    useReusableCollection.mockReturnValueOnce({
      status: 'unresolved',
      reference: 'missing-collection',
    })
    const view = await render(
      <EmbeddedCollection
        embed={{
          selection: { kind: 'definition', reference: 'missing-collection' },
          view: 'table',
          sorts: [],
          group: null,
          filters: [],
          match: 'all',
        }}
      />,
    )

    await expect.element(view.getByText(/could not be resolved/)).toBeInTheDocument()
  })

  it('applies the fence’s filter lines to the rows it shows', async () => {
    const view = await render(
      <EmbeddedCollection
        embed={{
          selection: { kind: 'tag', tag: 'book' },
          view: 'table',
          sorts: [],
          match: 'all',
          group: null,
          filters: [{ key: 'author', operator: 'is', text: 'Herbert' }],
        }}
      />,
    )
    await expect.element(view.getByText('Dune')).toBeInTheDocument()
    expect(view.getByText('The Dispossessed').query()).toBeNull()
  })

  it('renders the live table for a typed tag fence', async () => {
    const view = await render(
      <EmbeddedCollection
        embed={{
          selection: { kind: 'tag', tag: 'book' },
          view: 'table',
          sorts: [],
          group: null,
          filters: [],
          match: 'all',
        }}
      />,
    )
    const root = view.getByTestId('collection-embed')
    await expect.element(root).toBeInTheDocument()
    await expect.element(root).toHaveAttribute('data-collection-tag', 'book')
    await expect.element(root).toHaveAttribute('data-collection-view', 'table')
    await expect.element(view.getByText('Dune')).toBeInTheDocument()
    await expect.element(view.getByText('Herbert')).toBeInTheDocument()
  })

  it('renders shelf rows for a fence with a group: line (Plan 29 V1b)', async () => {
    const view = await render(
      <EmbeddedCollection
        embed={{
          selection: { kind: 'tag', tag: 'book' },
          view: 'table',
          sorts: [],
          group: 'status',
          filters: [],
          match: 'all',
        }}
      />,
    )
    await expect.element(view.getByRole('heading', { name: /reading\s*1/ })).toBeInTheDocument()
    await expect.element(view.getByRole('heading', { name: /No Status\s*1/ })).toBeInTheDocument()
  })
})
