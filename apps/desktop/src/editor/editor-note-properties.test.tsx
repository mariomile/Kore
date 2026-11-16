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
        <EditorNoteProperties path="notes/project.md" className="kore-content-gutter" />
      </NoteEditor>,
    )

    const title = view.container.querySelector<HTMLElement>('.ProseMirror > h1:first-child')
    const properties = view.container.querySelector<HTMLElement>('.kore-note-properties-slot')
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

  it('hides a tag-only membership line and keeps a sentence that mentions the tag', async () => {
    const view = await render(
      <NoteEditor initialContent={'# Project\n\n#project\n\nSee also #project later.'}>
        <EditorNoteProperties path="notes/project.md" className="kore-content-gutter" />
      </NoteEditor>,
    )

    await expect
      .poll(() => view.container.querySelector('.kore-editor-has-properties'))
      .not.toBeNull()
    await expect.poll(() => view.container.querySelectorAll('.md-tag').length).toBeGreaterThan(0)

    await expect
      .poll(
        () => {
          const paragraphs = [...view.container.querySelectorAll('.ProseMirror > p')]
          return paragraphs.map((node) => ({
            text: node.textContent,
            hidden: getComputedStyle(node).visibility === 'hidden',
          }))
        },
        { timeout: 4000 },
      )
      .toEqual([
        { text: '#project', hidden: true },
        { text: 'See also #project later.', hidden: false },
      ])
  })

  it('places fields under a title that follows a blank line after the frontmatter', async () => {
    const view = await render(
      <NoteEditor initialContent={'\n# Project\n\nBody'}>
        <EditorNoteProperties path="notes/project.md" className="kore-content-gutter" />
      </NoteEditor>,
    )

    const properties = view.container.querySelector<HTMLElement>('.kore-note-properties-slot')
    await expect.poll(() => properties?.dataset.positioned).toBe('true')
    const title = view.container.querySelector<HTMLElement>('.ProseMirror > h1')
    const body = [...view.container.querySelectorAll<HTMLElement>('.ProseMirror > p')].find(
      (node) => node.textContent === 'Body',
    )
    expect(title).not.toBeNull()
    expect(body).toBeDefined()
    await expect
      .poll(
        () =>
          properties!.getBoundingClientRect().top >= title!.getBoundingClientRect().bottom &&
          body!.getBoundingClientRect().top >= properties!.getBoundingClientRect().bottom,
      )
      .toBe(true)
  })

  it('shows fields above the body of a note with no title line', async () => {
    const view = await render(
      <NoteEditor initialContent={'Body without a title'}>
        <EditorNoteProperties path="notes/project.md" className="kore-content-gutter" />
      </NoteEditor>,
    )

    const properties = view.container.querySelector<HTMLElement>('.kore-note-properties-slot')
    await expect.poll(() => properties?.dataset.positioned).toBe('true')
    const body = view.container.querySelector<HTMLElement>('.ProseMirror > p')
    await expect
      .poll(() => body!.getBoundingClientRect().top)
      .toBeGreaterThanOrEqual(properties!.getBoundingClientRect().bottom)
  })
})
