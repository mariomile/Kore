import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import type { CollectionEntry, TagType } from '@reflect/core'
import { EmbeddedCollection } from './embedded-collection'

const BOOK_TYPE: TagType = {
  properties: [{ name: 'Author', key: 'author', type: 'text' }],
}

const ENTRIES: CollectionEntry[] = [
  {
    path: 'notes/dune.md',
    title: 'Dune',
    mtime: 1,
    isPinned: false,
    properties: {
      author: { value: 'Herbert', valueType: 'string', valueNumber: null },
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
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', name: 'g', generation: 1 } }),
}))

describe('EmbeddedCollection', () => {
  it('renders the live table for a typed tag fence', async () => {
    const view = await render(<EmbeddedCollection embed={{ tag: 'book', view: 'table' }} />)
    const root = view.getByTestId('collection-embed')
    await expect.element(root).toBeInTheDocument()
    await expect.element(root).toHaveAttribute('data-collection-tag', 'book')
    await expect.element(root).toHaveAttribute('data-collection-view', 'table')
    await expect.element(view.getByText('Dune')).toBeInTheDocument()
    await expect.element(view.getByText('Herbert')).toBeInTheDocument()
  })
})
