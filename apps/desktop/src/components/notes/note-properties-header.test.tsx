import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import type { ReactElement } from 'react'
import type { CollectionValue, NoteTagEntry, TagSuggestion, TagTypeEntry } from '@kore/core'
import { setPlatformSurface } from '@/lib/platform-surface'
import { NotePropertiesHeader } from './note-properties-header'

const data = vi.hoisted(() => ({
  tags: [] as NoteTagEntry[],
  tagTypes: [] as TagTypeEntry[],
  suggestions: [] as TagSuggestion[],
  values: {} as Record<string, CollectionValue>,
}))
const commitProperty = vi.hoisted(() => vi.fn())

vi.mock('@kore/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kore/core')>()),
  listTagsOnNote: async () => data.tags,
  listTagTypes: async () => data.tagTypes,
  suggestTags: async () => data.suggestions,
  getNoteProperties: async () => data.values,
}))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', generation: 1 } }),
}))
vi.mock('@/hooks/use-bridge-ready', () => ({ useBridgeReady: () => true }))
vi.mock('@/providers/settings-provider', async () => {
  const { DEFAULT_SETTINGS } = await import('@kore/core')
  return { useSettings: () => ({ settings: DEFAULT_SETTINGS }) }
})
vi.mock('@/lib/tags/use-commit-note-property', () => ({
  useCommitNoteProperty: () => commitProperty,
  invalidateOnNextIndexApply: () => {},
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
const setTagPropertyType = vi.hoisted(() => vi.fn(async () => {}))
const addTagProperty = vi.hoisted(() => vi.fn(async () => {}))
const removeTagProperty = vi.hoisted(() => vi.fn(async () => {}))
const renameTagProperty = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/lib/tags/schema-edits', () => ({
  addTagProperty,
  removeTagProperty,
  renameTagProperty,
  setTagPropertyType,
}))
vi.mock('@/lib/haptics', () => ({ haptic: () => {} }))

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
  setTagPropertyType.mockClear()
})

describe('NotePropertiesHeader', () => {
  it('shows no rows on a note with neither tags nor properties, only "Add tag"', async () => {
    const view = await render(<Subject />)

    const header = view.getByRole('region', { name: 'Properties' })
    await expect.element(header.getByRole('button', { name: 'Add tag' })).toBeInTheDocument()
    expect(header.getByText('Tags', { exact: true }).elements()).toHaveLength(0)
  })

  it('stays completely empty on mobile when a note has neither tags nor properties', async () => {
    setPlatformSurface({ mobileApp: true })
    try {
      const view = await render(<Subject />)
      await expect.poll(() => view.container.textContent).toBe('')
    } finally {
      setPlatformSurface({ mobileApp: false })
    }
  })

  it('renders nothing on a template', async () => {
    const view = await render(<Subject path="templates/book.md" />)
    await expect.poll(() => view.container.textContent).toBe('')
  })

  it('renders and edits a note-owned property alongside the Tags row', async () => {
    data.values = {
      follow_up: { value: 'Call Ada', valueType: 'string', valueNumber: null },
    }
    const view = await render(<Subject />)

    const header = view.getByRole('region', { name: 'Properties' })
    await expect.element(header.getByText('follow_up')).toBeInTheDocument()
    await expect.element(header.getByText('Call Ada')).toBeInTheDocument()
    await expect.element(header.getByText('Tags')).toBeInTheDocument()
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
    await expect.element(header.getByText('Book', { exact: true })).toBeInTheDocument()
    await expect.element(header.getByText('📚')).toBeInTheDocument()
  })

  it('chips a tag that has no schema, so the collapsed membership line stays visible', async () => {
    data.tags = [untyped('idea')]
    const view = await render(<Subject />)

    const header = view.getByRole('region', { name: 'Properties' })
    await expect.element(header.getByText('Idea', { exact: true })).toBeInTheDocument()
    // The chip's glyph is the `#`; the name never repeats it (`# #idea`).
    expect(header.element().textContent).not.toContain('#')
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
    await expect.element(header.getByText('Tags')).toBeInTheDocument()
    await expect.element(header.getByText('Project', { exact: true })).toBeInTheDocument()
    await expect.element(header.getByText('Person', { exact: true })).toBeInTheDocument()

    await view.getByRole('button', { name: 'Remove #project' }).click()
    expect(removeTag).toHaveBeenCalledWith('notes/dispossessed.md', 'project')
  })

  it('adds the tag the picker chooses, configured tags first', async () => {
    data.tagTypes = [{ tagKey: 'book', notePath: 'tags/book.md', type: { properties: [] } }]
    data.suggestions = [
      { tag: 'idea', count: 9 },
      { tag: 'book', count: 3 },
    ]
    const view = await render(<Subject />)

    await view.getByRole('button', { name: 'Add tag' }).click()
    await expect.element(view.getByText('Configured', { exact: true })).toBeInTheDocument()
    await expect.element(view.getByText('Other tags', { exact: true })).toBeInTheDocument()
    // `book` is configured, so it appears once, above the unconfigured suggestions.
    await expect.element(view.getByText('#idea')).toBeInTheDocument()
    expect(view.getByText('#book').elements()).toHaveLength(1)

    await view.getByText('#book').click()
    expect(addTag).toHaveBeenCalledWith('notes/dispossessed.md', 'book')
  })

  it('offers an unused name as itself and never re-offers a carried tag', async () => {
    data.tags = [untyped('idea')]
    data.suggestions = [{ tag: 'idea', count: 9 }]
    const view = await render(<Subject />)

    await view.getByRole('button', { name: 'Add tag' }).click()
    await view.getByRole('combobox').fill('recipe')
    await expect.element(view.getByText('Create #recipe')).toBeInTheDocument()

    await view.getByRole('combobox').fill('idea')
    // Carried already: neither the list nor the "create" row offers it again.
    await expect.element(view.getByText('No matching tag.')).toBeInTheDocument()
  })

  it('shows each field type on its label and changes it in the owning type', async () => {
    data.tags = [
      {
        tag: 'Meeting',
        tagKey: 'meeting',
        definitionPath: 'tags/meeting.md',
        type: { properties: [{ name: 'Company', key: 'company', type: 'relation' }] },
      },
    ]
    const view = await render(<Subject />)

    await view.getByRole('button', { name: 'Company (Relation)' }).click()
    await expect.element(view.getByText('Type, for every #Meeting note')).toBeInTheDocument()
    await expect
      .element(view.getByRole('menuitemradio', { name: 'Relation', exact: true }))
      .toHaveAttribute('aria-checked', 'true')
    await view.getByRole('menuitemradio', { name: 'Text', exact: true }).click()
    await vi.waitFor(() =>
      expect(setTagPropertyType).toHaveBeenCalledWith('Meeting', 1, 'company', 'text'),
    )
  })

  it('attributes inherited sub-tag properties to the defining ancestor tag', async () => {
    data.tags = [
      {
        tag: 'book/sci-fi',
        tagKey: 'book/sci-fi',
        definitionPath: 'tags/book.md',
        type: { properties: [{ name: 'Author', key: 'author', type: 'text' }] },
      },
    ]
    const view = await render(<Subject />)

    await view.getByRole('button', { name: 'Author (Text)' }).click()
    await expect.element(view.getByText('Type, for every #book note')).toBeInTheDocument()
    await view.getByRole('menuitemradio', { name: 'Number', exact: true }).click()
    await vi.waitFor(() =>
      expect(setTagPropertyType).toHaveBeenCalledWith('book', 1, 'author', 'number'),
    )
  })

  it('names a loose field type without offering a change', async () => {
    data.values = { follow_up: { value: 'Call Ada', valueType: 'string', valueNumber: null } }
    const view = await render(<Subject />)

    await view.getByRole('button', { name: 'follow_up (Text)' }).click()
    await expect.element(view.getByText('Type: Text')).toBeInTheDocument()
    expect(view.getByRole('menuitemradio').elements()).toHaveLength(0)
  })

  it('uses animated mobile sheets for property values and labels on iPhone', async () => {
    setPlatformSurface({ mobileApp: true })
    try {
      data.tags = [
        {
          tag: 'project',
          tagKey: 'project',
          definitionPath: 'tags/project.md',
          type: {
            properties: [
              { name: 'Status', key: 'status', type: 'status', options: ['active', 'paused'] },
            ],
          },
        },
      ]
      data.values = {
        status: { value: 'active', valueType: 'string', valueNumber: null },
      }
      const view = await render(<Subject />)

      // Collapsed summary shows the filled status value right beside the tag chip.
      await expect.element(view.getByText('active')).toBeVisible()
      await view.getByRole('button', { expanded: false }).click()

      // Tapping the value opens the animated MobileCellEditorDrawer sheet.
      await view.getByRole('button', { name: 'Edit Status' }).click()
      await view.getByRole('option', { name: 'paused' }).click()
      expect(commitProperty).toHaveBeenCalledWith('notes/dispossessed.md', 'status', 'paused')

      // Tapping the property label opens the Notion-style PropertyLabelSheet.
      await view.getByRole('button', { name: 'Status (Status)' }).click()
      await view.getByRole('button', { name: 'Rename' }).click()
      await view.getByRole('textbox', { name: 'Property name' }).fill('Stage')
      await view.getByRole('button', { name: 'Save' }).click()
      await vi.waitFor(() =>
        expect(renameTagProperty).toHaveBeenCalledWith('project', 1, 'status', 'Stage'),
      )
    } finally {
      setPlatformSurface({ mobileApp: false })
    }
  })
})
