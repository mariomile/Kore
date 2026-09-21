import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from 'vitest-browser-react'
import {
  PRIVATE_NOTE_EDIT_ERROR,
  TAG_DEFINITION_UNMARKED_ERROR,
  type TagProperty,
} from '@reflect/core'

const AUTHOR: TagProperty = { name: 'Author', key: 'author', type: 'text' }
const WRITTEN_BY: TagProperty = { name: 'Written by', key: 'written-by', type: 'text' }

const definition = vi.hoisted(() => ({
  path: 'tags/book.md',
  exists: true,
  needsConversion: false,
  properties: [] as TagProperty[],
  template: null as string | null,
  icon: null as string | null,
}))
const source = vi.hoisted(() => ({ text: '---\nlore: tag\nicon: 📚\n---\n' }))
const saveTagType = vi.hoisted(() => vi.fn(async () => {}))
const planPropertyRenames = vi.hoisted(() => vi.fn(async () => [] as unknown[]))
const migratePropertyRenames = vi.hoisted(() => vi.fn(async () => {}))
const calls = vi.hoisted(() => ({ order: [] as string[] }))

vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', name: 'g', generation: 7 } }),
}))
vi.mock('@/lib/tags/use-commit-note-property', () => ({ invalidateOnNextIndexApply: () => {} }))
vi.mock('@/lib/tags/tag-type-write', () => ({
  readTagDefinition: async () => definition,
  saveTagType,
}))
vi.mock('@/lib/tags/schema-renames', () => ({ planPropertyRenames, migratePropertyRenames }))
vi.mock('@/lib/note-frontmatter', () => ({ readNoteSource: async () => source.text }))

const { useApplyTagSchema, STALE_TAG_SCHEMA_MESSAGE } = await import('./use-apply-tag-schema')

beforeEach(() => {
  calls.order = []
  saveTagType.mockClear()
  saveTagType.mockImplementation(async () => {
    calls.order.push('save')
  })
  planPropertyRenames.mockClear()
  planPropertyRenames.mockImplementation(async () => [])
  migratePropertyRenames.mockClear()
  migratePropertyRenames.mockImplementation(async () => {
    calls.order.push('migrate')
  })
  definition.exists = true
  definition.needsConversion = false
  definition.properties = [AUTHOR]
  definition.template = 'templates/book.md'
  definition.icon = '📚'
  source.text = '---\nlore: tag\nicon: 📚\n---\n'
})

describe('useApplyTagSchema', () => {
  it('writes the schema through the definition writer, keeping icon and template', async () => {
    const { result } = await renderHook(() => useApplyTagSchema())
    await result.current({
      tag: 'Book',
      properties: [AUTHOR, { name: 'Read on', key: 'read-on', type: 'date' }],
      previousProperties: [AUTHOR],
      renames: [],
    })
    expect(saveTagType).toHaveBeenCalledWith(
      'Book',
      [AUTHOR, { name: 'Read on', key: 'read-on', type: 'date' }],
      7,
      'templates/book.md',
      '📚',
    )
    expect(migratePropertyRenames).toHaveBeenCalledWith([], 7)
  })

  it('migrates a renamed key after the schema lands, planned against the index now', async () => {
    const planned = [{ from: 'author', to: 'written-by', notes: [] }]
    planPropertyRenames.mockImplementation(async () => planned)
    const { result } = await renderHook(() => useApplyTagSchema())
    await result.current({
      tag: 'book',
      properties: [WRITTEN_BY],
      previousProperties: [AUTHOR],
      renames: [{ from: 'author', to: 'written-by' }],
    })
    expect(planPropertyRenames).toHaveBeenCalledWith([{ from: 'author', to: 'written-by' }])
    expect(migratePropertyRenames).toHaveBeenCalledWith(planned, 7)
    // Schema first: a migration that dies partway leaves values under a key
    // the user can still see, never the schema naming a key nothing holds.
    expect(calls.order).toEqual(['save', 'migrate'])
  })

  it('creates the definition for a tag that has none yet', async () => {
    // A missing file reads as an empty note on the session-or-disk channel,
    // which `readTagDefinition` reports as an unmarked note: that is the
    // brand-new tag, not a regular note to refuse.
    source.text = ''
    definition.needsConversion = true
    definition.properties = []
    definition.template = null
    definition.icon = null
    const { result } = await renderHook(() => useApplyTagSchema())
    await result.current({
      tag: 'decision',
      properties: [AUTHOR],
      previousProperties: [],
      renames: [],
    })
    expect(saveTagType).toHaveBeenCalledWith('decision', [AUTHOR], 7, null, null)
  })

  it('refuses a stale, private, or unmarked definition without writing', async () => {
    const { result } = await renderHook(() => useApplyTagSchema())
    await expect(
      result.current({
        tag: 'book',
        properties: [WRITTEN_BY],
        previousProperties: [],
        renames: [],
      }),
    ).rejects.toThrow(STALE_TAG_SCHEMA_MESSAGE)
    source.text = '---\nlore: tag\nprivate: true\n---\n'
    await expect(
      result.current({
        tag: 'book',
        properties: [WRITTEN_BY],
        previousProperties: [AUTHOR],
        renames: [],
      }),
    ).rejects.toThrow(PRIVATE_NOTE_EDIT_ERROR)
    source.text = '# Book\n'
    definition.needsConversion = true
    await expect(
      result.current({
        tag: 'book',
        properties: [WRITTEN_BY],
        previousProperties: [AUTHOR],
        renames: [],
      }),
    ).rejects.toThrow(TAG_DEFINITION_UNMARKED_ERROR)
    expect(saveTagType).not.toHaveBeenCalled()
    expect(migratePropertyRenames).not.toHaveBeenCalled()
  })
})
