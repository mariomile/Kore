import { renderHook } from 'vitest-browser-react'
import { describe, expect, it } from 'vitest'
import type { NoteEditorHandle } from './note-editor'
import { useCalloutSlashItems } from './use-callout-slash-items'

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

describe('useCalloutSlashItems', () => {
  it('lists GitHub alert kinds and inserts a typed fence on select', async () => {
    const editor = fakeEditor()
    const { result } = await renderHook(() => useCalloutSlashItems(() => editor))
    const items = await result.current('')
    expect(items.map((item) => item.id)).toEqual([
      'callout:note',
      'callout:tip',
      'callout:important',
      'callout:warning',
      'callout:caution',
    ])
    items[0]!.onSelect()
    expect(editor.inserted).toEqual(['> [!NOTE]\n> \n'])
  })

  it('resolves the editor at select time, not capture time', async () => {
    const { result } = await renderHook(() => useCalloutSlashItems(() => null))
    const items = await result.current('')
    items[0]!.onSelect()
  })
})
