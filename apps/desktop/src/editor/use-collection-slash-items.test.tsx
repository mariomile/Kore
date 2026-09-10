import { renderHook } from 'vitest-browser-react'
import { describe, expect, it, vi } from 'vitest'
import type { CollectionDefinition } from '@reflect/core'
import type { NoteEditorHandle } from './note-editor'

const listNoteTags = vi.hoisted(() =>
  vi.fn(async () => [
    { tag: 'Book', count: 2 },
    { tag: 'project', count: 1 },
  ]),
)
const listCollectionDefinitions = vi.hoisted(() =>
  vi.fn<() => Promise<CollectionDefinition[]>>(async () => []),
)
const hasBridge = vi.hoisted(() => vi.fn(() => true))
const stableCollectionReferenceForPath = vi.hoisted(() =>
  vi.fn(async (path: string) => (path === 'notes/page.md' ? 'page-id' : path)),
)
vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  listNoteTags,
  listCollectionDefinitions,
  hasBridge,
}))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', generation: 1 } }),
}))
vi.mock('@/lib/tags/reusable-collection-write', () => ({ stableCollectionReferenceForPath }))

const { useCollectionSlashItems } = await import('./use-collection-slash-items')

function fakeEditor(): NoteEditorHandle & { inserted: string[] } {
  const inserted: string[] = []
  return {
    inserted,
    getMarkdown: () => '',
    setMarkdown: () => {},
    insertMarkdown: (markdown) => {
      inserted.push(markdown)
    },
    focus: () => {},
    setSelection: () => {},
    getSelectedText: () => '',
    openSelectionMenu: () => {},
    startPendingReplacement: () => false,
    appendPendingReplacementText: () => {},
    acceptPendingReplacement: () => {},
    discardPendingReplacement: () => {},
    findNext: () => {},
    findPrevious: () => {},
    undo: () => {},
    redo: () => {},
  }
}

describe('useCollectionSlashItems', () => {
  it('lists every tag (folded) and inserts a collection fence on select', async () => {
    const editor = fakeEditor()
    const { result } = await renderHook(() => useCollectionSlashItems(() => editor))

    const items = await result.current('')
    expect(
      items.map((item) => ({
        id: item.id,
        label: item.label,
        keywords: item.keywords,
      })),
    ).toEqual([
      {
        id: 'collection:book',
        label: 'Collection: #book',
        keywords: ['collection', 'embed', 'database', 'book'],
      },
      {
        id: 'collection:project',
        label: 'Collection: #project',
        keywords: ['collection', 'embed', 'database', 'project'],
      },
    ])

    items[0]!.onSelect()
    expect(editor.inserted).toEqual(['```collection\ntag: book\n```\n'])
  })

  it('resolves the editor at select time, not capture time', async () => {
    const { result } = await renderHook(() => useCollectionSlashItems(() => null))
    const items = await result.current('')
    items[0]!.onSelect()
  })

  it('offers creation and existing named definitions', async () => {
    listCollectionDefinitions.mockResolvedValueOnce([
      {
        id: 'page-id',
        path: 'notes/page.md',
        title: 'Page',
        config: {
          version: 1,
          sources: { tags: ['task'], include: [], exclude: [] },
        },
      },
    ])
    const editor = fakeEditor()
    const openCreate = vi.fn()
    const { result } = await renderHook(() => useCollectionSlashItems(() => editor, openCreate))

    const items = await result.current('')
    expect(items.slice(0, 2).map((item) => item.label)).toEqual([
      'Create collection…',
      'Collection: Page',
    ])
    items[0]!.onSelect()
    items[1]!.onSelect()

    expect(openCreate).toHaveBeenCalledOnce()
    expect(editor.inserted).toEqual(['```collection\ncollection: page-id\n```\n'])
  })

  it('uses a definition path when its id is not a unique stable reference', async () => {
    listCollectionDefinitions.mockResolvedValueOnce([
      {
        id: 'duplicate-id',
        path: 'notes/copy.md',
        title: 'Copy',
        config: {
          version: 1,
          sources: { tags: [], include: [], exclude: [] },
        },
      },
    ])
    const editor = fakeEditor()
    const { result } = await renderHook(() => useCollectionSlashItems(() => editor))

    const items = await result.current('')
    items[0]!.onSelect()

    expect(items[0]!.id).toBe('collection:definition:notes/copy.md')
    expect(editor.inserted).toEqual(['```collection\ncollection: notes/copy.md\n```\n'])
  })

  it('returns nothing without a bridge', async () => {
    hasBridge.mockReturnValueOnce(false)
    const { result } = await renderHook(() => useCollectionSlashItems(() => fakeEditor()))
    await expect(result.current('')).resolves.toEqual([])
  })
})
