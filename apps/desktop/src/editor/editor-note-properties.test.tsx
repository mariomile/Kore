import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import '@/styles/index.css'
import { NoteEditor } from './note-editor'

vi.mock('@/components/notes/note-properties-header', () => ({
  NotePropertiesHeader: () => (
    <section aria-label="Properties" className="h-16 border-b border-border">
      Status: To do
    </section>
  ),
}))

const { EditorNoteProperties } = await import('./editor-note-properties')

describe('EditorNoteProperties', () => {
  it('places typed fields between the editable title and body', async () => {
    const view = await render(
      <NoteEditor initialContent={'# Project\n\nBody'}>
        <EditorNoteProperties path="notes/project.md" className="reflect-content-gutter" />
      </NoteEditor>,
    )

    const title = view.container.querySelector<HTMLElement>('.ProseMirror > h1:first-child')
    const properties = view.container.querySelector<HTMLElement>('.reflect-note-properties-slot')
    const body = view.container.querySelector<HTMLElement>('.ProseMirror > p')
    expect(title).not.toBeNull()
    expect(properties).not.toBeNull()
    expect(body).not.toBeNull()
    await expect.poll(() => properties?.dataset.positioned).toBe('true')

    const titleRect = title!.getBoundingClientRect()
    const propertiesRect = properties!.getBoundingClientRect()
    const bodyRect = body!.getBoundingClientRect()
    expect(propertiesRect.top).toBeGreaterThanOrEqual(titleRect.bottom)
    expect(bodyRect.top).toBeGreaterThanOrEqual(propertiesRect.bottom)
  })
})
