import { renderHook } from 'vitest-browser-react'
import { describe, expect, it, vi } from 'vitest'
import type { NoteEditorHandle } from './note-editor'

const listTemplates = vi.hoisted(() =>
  vi.fn(async () => [
    { path: 'templates/journal.md', title: 'Journal', mtime: 1 },
    { path: 'templates/person.md', title: 'Person', mtime: 2 },
  ]),
)
const hasBridge = vi.hoisted(() => vi.fn(() => true))
const insertTemplate = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  listTemplates,
  hasBridge,
}))
vi.mock('@/lib/note-templates', () => ({ insertTemplate }))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', generation: 1 } }),
}))
const VALUES = vi.hoisted(() => ({
  title: 'Plan',
  date: 'Wed, August 20th, 2026',
  dateIso: '2026-08-20',
  time: '9:41 AM',
}))
vi.mock('@/hooks/use-template-values', () => ({
  useTemplateValues: () => async () => VALUES,
}))

const { useTemplateSlashItems } = await import('./use-template-slash-items')

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

describe('useTemplateSlashItems', () => {
  it('maps templates to slash rows whose select inserts through the shared flow', async () => {
    const editor = fakeEditor()
    const { result } = await renderHook(() => useTemplateSlashItems(() => editor, 'notes/plan.md'))

    const items = await result.current('jour')
    expect(
      items.map((item) => ({
        id: item.id,
        label: item.label,
        keywords: item.keywords,
      })),
    ).toEqual([
      // The shared "template" keyword is the v1 `/template` affordance.
      { id: 'templates/journal.md', label: 'Journal', keywords: ['template'] },
      { id: 'templates/person.md', label: 'Person', keywords: ['template'] },
    ])

    items[0]!.onSelect()
    await vi.waitFor(() =>
      expect(insertTemplate).toHaveBeenCalledWith('templates/journal.md', editor, VALUES),
    )
  })

  it('resolves the editor at select time, not capture time', async () => {
    // The pane unmounted between the menu opening and the select — the shared
    // flow receives null and surfaces the failure, never a stale editor.
    const { result } = await renderHook(() => useTemplateSlashItems(() => null, 'notes/plan.md'))
    const items = await result.current('')
    items[0]!.onSelect()
    await vi.waitFor(() =>
      expect(insertTemplate).toHaveBeenCalledWith('templates/journal.md', null, VALUES),
    )
  })

  it('returns nothing without a bridge', async () => {
    hasBridge.mockReturnValueOnce(false)
    const { result } = await renderHook(() =>
      useTemplateSlashItems(() => fakeEditor(), 'notes/plan.md'),
    )
    await expect(result.current('')).resolves.toEqual([])
  })
})
