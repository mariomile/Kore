import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import type { ReactElement } from 'react'
import type { CollectionValue, NoteTagEntry } from '@reflect/core'
import { NotePropertiesSection } from './note-properties-section'

const data = vi.hoisted(() => ({
  tags: [] as NoteTagEntry[],
  values: {} as Record<string, CollectionValue>,
}))
const commitProperty = vi.hoisted(() => vi.fn())

vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  listTagsOnNote: async () => data.tags,
  listTagTypes: async () => [],
  suggestTags: async () => [],
  getNoteProperties: async () => data.values,
}))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', generation: 1 } }),
}))
vi.mock('@/hooks/use-bridge-ready', () => ({ useBridgeReady: () => true }))
vi.mock('@/lib/tags/use-commit-note-property', () => ({
  useCommitNoteProperty: () => commitProperty,
  invalidateOnNextIndexApply: () => {},
}))
const addTag = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/lib/tags/use-add-note-tag', () => ({ useAddNoteTag: () => addTag }))
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
  data.tags = []
  data.values = {}
  commitProperty.mockClear()
  removeTag.mockClear()
  addTag.mockClear()
})

describe('NotePropertiesSection', () => {
  it('renders nothing while the note carries no tag and no stored property', async () => {
    const view = await render(<Subject />)
    await expect.poll(() => view.container.textContent).toBe('')
  })

  it('shows note-owned properties, and the Type row offers one without inventing it', async () => {
    data.values = {
      status: { value: 'waiting', valueType: 'string', valueNumber: null },
    }
    const view = await render(<Subject />)

    await expect.element(view.getByText('Status')).toBeInTheDocument()
    await expect.element(view.getByText('waiting')).toBeInTheDocument()
    await expect.element(view.getByRole('button', { name: 'Set the type' })).toBeInTheDocument()
  })

  it('renders the union of the tags’ schemas with current values, once per key', async () => {
    data.tags = [
      {
        tag: 'book',
        tagKey: 'book',
        definitionPath: 'tags/book.md',
        type: {
          properties: [
            { name: 'Author', key: 'author', type: 'text' },
            { name: 'Read', key: 'read', type: 'checkbox' },
          ],
        },
      },
      {
        tag: 'media',
        tagKey: 'media',
        definitionPath: 'tags/media.md',
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
