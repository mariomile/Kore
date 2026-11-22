import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import '@/test-utils/locator'
import { NoteEditor, type NoteEditorHandle } from './note-editor'

const NOTE =
  '- [ ] Call Luca [[2026-11-20]]\n- See [[2025-01-03]] and [[2026-11-21|Saturday]]\n- [[Lisbon]]\n- Screen on 2026-11-24, logged 2026-11-24T09:00 in `2026-11-25`\n'

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

describe('DateChips', () => {
  it('reads date links as a weekday chip and leaves the markdown alone', async () => {
    const handle = await renderNote()
    const year = new Date().getFullYear()
    const nov20 = year === 2026 ? 'Fri, Nov 20' : 'Nov 20, 2026'
    expect(labels()).toEqual([nov20, 'Jan 3, 2025', 'Saturday', 'Lisbon'])
    expect(handle.getMarkdown()).toBe(NOTE)
  })

  it('draws a plain date as the same chip, and only a free-standing one', async () => {
    const handle = await renderNote()
    const chips = [...document.querySelectorAll('.kore-date-chip:not([data-date-link])')]
    const year = new Date().getFullYear()
    expect(chips.map((chip) => chip.textContent)).toEqual([
      year === 2026 ? 'Tue, Nov 24' : 'Nov 24, 2026',
    ])
    expect(handle.getMarkdown()).toBe(NOTE)
  })

  it('draws a typed date as one chip, and an inserted date link as its link chip only', async () => {
    const handle = await renderNote()
    handle.focus()
    await userEvent.keyboard('{Control>}{End}{/Control}')
    await userEvent.keyboard(' see 2026-12-01 ok')
    handle.insertMarkdown(' and [[2026-12-02]]')
    await expect
      .poll(() => document.querySelectorAll('.kore-date-chip[data-date="2026-12-01"]').length)
      .toBe(1)
    expect(document.querySelectorAll('.kore-date-chip[data-date="2026-12-02"]')).toHaveLength(0)
  })

  it('shows the plain date as text while the caret is on it', async () => {
    const handle = await renderNote()
    const chip = document.querySelector<HTMLElement>('.kore-date-chip:not([data-date-link])')!
    chip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    await expect
      .poll(() => document.querySelectorAll('.kore-date-chip:not([data-date-link])').length)
      .toBe(0)
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
