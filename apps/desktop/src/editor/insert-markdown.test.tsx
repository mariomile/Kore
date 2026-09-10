import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import '@/test-utils/locator'
import { NoteEditor, type NoteEditorHandle } from './note-editor'
import { insertCollectionEmbed } from './use-collection-slash-items'

const pmRoot = page.locate('.ProseMirror')

describe('NoteEditorHandle.insertMarkdown', () => {
  it('inserts the fragment into the document through the meowdown handle', async () => {
    let handle: NoteEditorHandle | null = null
    await render(
      <NoteEditor
        initialContent=""
        handleRef={(grabbed) => {
          handle = grabbed
        }}
      />,
    )
    await expect.element(pmRoot).toBeInTheDocument()

    handle!.insertMarkdown('# Journal\n\nMood:\n')
    await expect.element(page.getByText('Journal')).toBeInTheDocument()
    expect(handle!.getMarkdown()).toBe('# Journal\n\nMood:\n')
  })

  it('restores a bookmarked selection before inserting after a dialog', async () => {
    let handle: NoteEditorHandle | null = null
    await render(
      <NoteEditor
        initialContent={'before\n\nafter'}
        handleRef={(grabbed) => {
          handle = grabbed
        }}
      />,
    )
    await expect.element(pmRoot).toBeInTheDocument()

    handle!.setSelection({ type: 'text', anchor: 7, head: 7 })
    const bookmark = handle!.getSelection?.()
    handle!.setSelection('end')
    if (bookmark !== undefined) {
      handle!.setSelection(bookmark)
    }
    insertCollectionEmbed(handle!, {
      selection: { kind: 'definition', reference: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      view: 'table',
      sorts: [],
      group: null,
      filters: [],
      match: 'all',
    })

    expect(handle!.getMarkdown()).toBe(
      'before\n\n```collection\ncollection: 01ARZ3NDEKTSV4RRFFQ69G5FAV\n```\n\nafter\n',
    )
    expect(handle!.getSelection?.()).toEqual({ type: 'text', anchor: 49, head: 49 })
  })

  it('creates a following paragraph when a collection ends the document', async () => {
    let handle: NoteEditorHandle | null = null
    await render(
      <NoteEditor
        initialContent="before"
        handleRef={(grabbed) => {
          handle = grabbed
        }}
      />,
    )
    await expect.element(pmRoot).toBeInTheDocument()

    handle!.setSelection('end')
    insertCollectionEmbed(handle!, {
      selection: { kind: 'definition', reference: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      view: 'table',
      sorts: [],
      group: null,
      filters: [],
      match: 'all',
    })
    handle!.focus()
    await userEvent.keyboard('Next')

    expect(handle!.getMarkdown()).toBe(
      'before\n\n```collection\ncollection: 01ARZ3NDEKTSV4RRFFQ69G5FAV\n```\n\nNext\n',
    )
  })
})
