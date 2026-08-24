import { renderHook } from 'vitest-browser-react'
import { describe, expect, it, vi } from 'vitest'
import type { NoteEditorHandle } from './note-editor'

const listTagTypes = vi.hoisted(() =>
  vi.fn(async () => [
    { tagKey: 'book', notePath: 'tags/book.md', type: { properties: [] } },
    { tagKey: 'project', notePath: 'tags/project.md', type: { properties: [] } },
  ]),
)
const hasBridge = vi.hoisted(() => vi.fn(() => true))
vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  listTagTypes,
  hasBridge,
}))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', generation: 1 } }),
}))

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
  }
}

describe('useCollectionSlashItems', () => {
  it('lists typed tags and inserts a collection fence on select', async () => {
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

  it('returns nothing without a bridge', async () => {
    hasBridge.mockReturnValueOnce(false)
    const { result } = await renderHook(() => useCollectionSlashItems(() => fakeEditor()))
    await expect(result.current('')).resolves.toEqual([])
  })
})
