import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import type { CollectionEntry, TagType } from '@reflect/core'
import { EmbeddedCollection } from './embedded-collection'

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
  it('applies the fence’s filter lines to the rows it shows', async () => {
    const view = await render(
      <EmbeddedCollection
        embed={{
          tag: 'book',
          view: 'table',
          sort: null,
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
        embed={{ tag: 'book', view: 'table', sort: null, group: null, filters: [] }}
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
        embed={{ tag: 'book', view: 'table', sort: null, group: 'status', filters: [] }}
      />,
    )
    await expect.element(view.getByRole('heading', { name: /reading\s*1/ })).toBeInTheDocument()
    await expect.element(view.getByRole('heading', { name: /No Status\s*1/ })).toBeInTheDocument()
  })
})
