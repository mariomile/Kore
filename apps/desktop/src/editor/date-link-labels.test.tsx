import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import '@/test-utils/locator'
import { NoteEditor, type NoteEditorHandle } from './note-editor'

const NOTE =
  '- [ ] Call Luca [[2026-11-20]]\n- See [[2025-01-03]] and [[2026-11-21|Saturday]]\n- [[Lisbon]]\n'

async function renderNote(dateFormat?: 'mdy' | 'dmy' | 'iso'): Promise<NoteEditorHandle> {
  let handle: NoteEditorHandle | null = null
  await render(
    <NoteEditor
      initialContent={NOTE}
      {...(dateFormat !== undefined ? { dateFormat } : {})}
      handleRef={(grabbed) => {
        handle = grabbed
      }}
    />,
  )
  await expect.element(page.locate('.ProseMirror').getByText('Call Luca')).toBeVisible()
  return handle!
}

function labels(): string[] {
  return [...document.querySelectorAll('.md-wikilink-view-label')].map(
    (label) => label.textContent ?? '',
  )
}

describe('DateLinkLabels', () => {
  it('reads date links as the compact date and leaves the markdown alone', async () => {
    const handle = await renderNote()
    const year = new Date().getFullYear()
    const nov20 = year === 2026 ? 'Nov 20' : 'Nov 20, 2026'
    expect(labels()).toEqual([nov20, 'Jan 3, 2025', 'Saturday', 'Lisbon'])
    expect(handle.getMarkdown()).toBe(NOTE)
  })

  it('keeps only the compact date on one line, so a long title wraps', async () => {
    await renderNote()
    const wrap = [...document.querySelectorAll('.md-wikilink-view-label')].map(
      (label) => getComputedStyle(label).whiteSpace,
    )
    expect(wrap.map((value) => value === 'nowrap')).toEqual([true, true, false, false])
  })

  it('follows the date format setting', async () => {
    await renderNote('iso')
    expect(labels()[0]).toBe('2026-11-20')
  })
})
