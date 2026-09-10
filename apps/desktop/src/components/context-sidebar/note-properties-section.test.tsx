import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import type { ReactElement } from 'react'
import type { CollectionValue, TagTypeEntry } from '@reflect/core'
import { NotePropertiesSection } from './note-properties-section'

const data = vi.hoisted(() => ({
  tagTypes: [] as TagTypeEntry[],
  values: {} as Record<string, CollectionValue>,
}))
const commitProperty = vi.hoisted(() => vi.fn())

vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  listNoteTagTypes: async () => data.tagTypes,
  getNoteProperties: async () => data.values,
}))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', generation: 1 } }),
}))
vi.mock('@/hooks/use-bridge-ready', () => ({ useBridgeReady: () => true }))
vi.mock('@/lib/tags/use-commit-note-property', () => ({
  useCommitNoteProperty: () => commitProperty,
}))
const removeTag = vi.hoisted(() => vi.fn())
vi.mock('@/lib/tags/use-remove-note-tag', () => ({
  useRemoveNoteTag: () => removeTag,
}))
vi.mock('@/lib/tags/use-open-relation', () => ({ useOpenRelation: () => vi.fn() }))

function Subject(): ReactElement {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <NotePropertiesSection path="notes/dispossessed.md" />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  data.tagTypes = []
  data.values = {}
  commitProperty.mockClear()
  removeTag.mockClear()
})

describe('NotePropertiesSection', () => {
  it('renders nothing while the note has no type or stored properties', async () => {
    const view = await render(<Subject />)
    await expect.poll(() => view.container.textContent).toBe('')
  })

  it('shows note-owned properties without adding a type', async () => {
    data.values = {
      status: { value: 'waiting', valueType: 'string', valueNumber: null },
    }
    const view = await render(<Subject />)

    await expect.element(view.getByText('Status')).toBeInTheDocument()
    await expect.element(view.getByText('waiting')).toBeInTheDocument()
    expect(view.getByText('Type').elements()).toHaveLength(0)
  })

  it('renders the union of the tags’ schemas with current values, once per key', async () => {
    data.tagTypes = [
      {
        tagKey: 'book',
        notePath: 'tags/book.md',
        type: {
          properties: [
            { name: 'Author', key: 'author', type: 'text' },
            { name: 'Read', key: 'read', type: 'checkbox' },
          ],
        },
      },
      {
        tagKey: 'media',
        notePath: 'tags/media.md',
        // `author` again — must render once (the first declaration wins).
        type: { properties: [{ name: 'Creator', key: 'author', type: 'text' }] },
      },
    ]
    data.values = {
      author: { value: 'Le Guin', valueType: 'string', valueNumber: null },
    }
    const view = await render(<Subject />)

    await expect.element(view.getByText('Author')).toBeInTheDocument()
    await expect.element(view.getByText('Le Guin')).toBeInTheDocument()
    await expect.element(view.getByText('#book')).toBeInTheDocument()
    await expect.element(view.getByText('#media')).toBeInTheDocument()
    expect(view.container.textContent).not.toContain('Creator')

    await view.getByRole('checkbox', { name: 'Read' }).click()
    expect(commitProperty).toHaveBeenCalledWith('notes/dispossessed.md', 'read', true)
  })
})
