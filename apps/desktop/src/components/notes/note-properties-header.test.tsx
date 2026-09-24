import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import type { ReactElement } from 'react'
import type { CollectionValue, NoteTagEntry, TagSuggestion, TagTypeEntry } from '@reflect/core'
import { NotePropertiesHeader } from './note-properties-header'

const data = vi.hoisted(() => ({
  tags: [] as NoteTagEntry[],
  tagTypes: [] as TagTypeEntry[],
  suggestions: [] as TagSuggestion[],
  values: {} as Record<string, CollectionValue>,
}))
const commitProperty = vi.hoisted(() => vi.fn())

vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  listTagsOnNote: async () => data.tags,
  listTagTypes: async () => data.tagTypes,
  suggestTags: async () => data.suggestions,
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
const addTag = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/lib/tags/use-add-note-tag', () => ({
  useAddNoteTag: () => addTag,
}))
vi.mock('@/lib/tags/use-open-relation', () => ({ useOpenRelation: () => vi.fn() }))

function Subject({ path = 'notes/dispossessed.md' }: { path?: string }): ReactElement {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <NotePropertiesHeader path={path} />
    </QueryClientProvider>
  )
}

/** A carried tag with no definition note behind it. */
function untyped(tag: string): NoteTagEntry {
  return { tag, tagKey: tag, type: null, definitionPath: null }
}

beforeEach(() => {
  data.tags = []
  data.tagTypes = []
  data.suggestions = []
  data.values = {}
  commitProperty.mockClear()
  removeTag.mockClear()
  addTag.mockClear()
})

describe('NotePropertiesHeader', () => {
  it('offers an empty Type row on a note that has neither tags nor properties', async () => {
    const view = await render(<Subject />)

    const header = view.getByRole('region', { name: 'Properties' })
    await expect.element(header.getByText('Type')).toBeInTheDocument()
    await expect.element(view.getByRole('button', { name: 'Set the type' })).toBeInTheDocument()
  })

  it('renders nothing on a template', async () => {
    const view = await render(<Subject path="templates/book.md" />)
    await expect.poll(() => view.container.textContent).toBe('')
  })

  it('renders and edits a note-owned property alongside the Type row', async () => {
    data.values = {
      follow_up: { value: 'Call Ada', valueType: 'string', valueNumber: null },
    }
    const view = await render(<Subject />)

    const header = view.getByRole('region', { name: 'Properties' })
    await expect.element(header.getByText('follow_up')).toBeInTheDocument()
    await expect.element(header.getByText('Call Ada')).toBeInTheDocument()
    await expect.element(header.getByText('Type')).toBeInTheDocument()
  })

  it('presents the row fields and commits an edit in place', async () => {
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
    ]
    data.values = {
      author: { value: 'Le Guin', valueType: 'string', valueNumber: null },
    }
    const view = await render(<Subject />)

    const header = view.getByRole('region', { name: 'Properties' })
    await expect.element(header.getByText('Author')).toBeInTheDocument()
    await expect.element(header.getByText('Le Guin')).toBeInTheDocument()

    await view.getByRole('checkbox', { name: 'Read' }).click()
    expect(commitProperty).toHaveBeenCalledWith('notes/dispossessed.md', 'read', true)
  })

  it('shows the tag icon on its Type chip', async () => {
    data.tags = [
      {
        tag: 'book',
        tagKey: 'book',
        definitionPath: 'tags/book.md',
        type: { properties: [], icon: '📚' },
      },
    ]
    const view = await render(<Subject />)

    const header = view.getByRole('region', { name: 'Properties' })
    await expect.element(header.getByText('#book')).toBeInTheDocument()
    await expect.element(header.getByText('📚')).toBeInTheDocument()
  })

  it('chips a tag that has no schema, so the collapsed membership line stays visible', async () => {
    data.tags = [untyped('idea')]
    const view = await render(<Subject />)

    const header = view.getByRole('region', { name: 'Properties' })
    await expect.element(header.getByText('#idea')).toBeInTheDocument()
  })

  it('lists Type chips for each tag and unsets one on remove', async () => {
    data.tags = [
      {
        tag: 'project',
        tagKey: 'project',
        definitionPath: 'tags/project.md',
        type: {
          properties: [{ name: 'Status', key: 'status', type: 'select', options: ['to do'] }],
        },
      },
      {
        tag: 'person',
        tagKey: 'person',
        definitionPath: 'tags/person.md',
        type: { properties: [{ name: 'Company', key: 'company', type: 'text' }] },
      },
    ]
    const view = await render(<Subject />)

    const header = view.getByRole('region', { name: 'Properties' })
    await expect.element(header.getByText('Type')).toBeInTheDocument()
    await expect.element(header.getByText('#project')).toBeInTheDocument()
    await expect.element(header.getByText('#person')).toBeInTheDocument()

    await view.getByRole('button', { name: 'Remove #project' }).click()
    expect(removeTag).toHaveBeenCalledWith('notes/dispossessed.md', 'project')
  })

  it('sets the type the picker chooses, schema-bearing tags first', async () => {
    data.tagTypes = [{ tagKey: 'book', notePath: 'tags/book.md', type: { properties: [] } }]
    data.suggestions = [
      { tag: 'idea', count: 9 },
      { tag: 'book', count: 3 },
    ]
    const view = await render(<Subject />)

    await view.getByRole('button', { name: 'Set the type' }).click()
    await expect.element(view.getByText('Types', { exact: true })).toBeInTheDocument()
    await expect.element(view.getByText('Other types')).toBeInTheDocument()
    // `book` is typed, so it appears once, above the untyped suggestions.
    await expect.element(view.getByText('#idea')).toBeInTheDocument()
    expect(view.getByText('#book').elements()).toHaveLength(1)

    await view.getByText('#book').click()
    expect(addTag).toHaveBeenCalledWith('notes/dispossessed.md', 'book')
  })

  it('offers an unused name as itself and never re-offers a carried tag', async () => {
    data.tags = [untyped('idea')]
    data.suggestions = [{ tag: 'idea', count: 9 }]
    const view = await render(<Subject />)

    await view.getByRole('button', { name: 'Add a type' }).click()
    await view.getByRole('combobox').fill('recipe')
    await expect.element(view.getByText('Use #recipe')).toBeInTheDocument()

    await view.getByRole('combobox').fill('idea')
    // Carried already: neither the list nor the "use it" row offers it again.
    await expect.element(view.getByText('No matching type.')).toBeInTheDocument()
  })
})
