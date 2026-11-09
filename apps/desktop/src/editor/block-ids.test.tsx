import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import '@/test-utils/locator'
import { BlockIds } from './block-ids'
import { BlockZoom } from './block-zoom'
import { NoteEditor, type NoteEditorHandle } from './note-editor'

const NOTE = [
  '# Pricing',
  '',
  '- Plans',
  '  - Pro costs 49 ^pro',
  '    - billed monthly',
  '- Other',
  '',
  'A table-like quote',
  '',
  '^quote',
  '',
  'Last line',
  '',
].join('\n')

const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? 'Meta' : 'Control'
const pmRoot = page.locate('.ProseMirror')

async function renderNote(): Promise<NoteEditorHandle> {
  let handle: NoteEditorHandle | null = null
  await render(
    <NoteEditor
      initialContent={NOTE}
      handleRef={(grabbed) => {
        handle = grabbed
      }}
    >
      <BlockZoom />
      <BlockIds />
    </NoteEditor>,
  )
  await expect.element(pmRoot.getByText('Last line')).toBeVisible()
  return handle!
}

function caretText(): string {
  const node = document.getSelection()?.anchorNode
  return (node instanceof Element ? node : node?.parentElement)?.textContent ?? ''
}

describe('BlockIds', () => {
  it('lands on the line a ^id names and flashes it, without touching the note', async () => {
    const handle = await renderNote()
    handle.focus()
    expect(handle.revealHeading?.('^pro')).toBe(true)
    const flashed = pmRoot.locate('.kore-block-flash')
    await expect.element(flashed).toBeVisible()
    expect(flashed.element().textContent).toContain('Pro costs 49')
    expect(flashed.element().textContent).not.toContain('billed monthly')
    expect(caretText()).toContain('Pro costs 49')
    // The flash fades on its own.
    await expect
      .poll(() => document.querySelector('.kore-block-flash'), { timeout: 3000 })
      .toBeNull()
    expect(handle.getMarkdown()).toBe(NOTE)
  })

  it('an id alone on its line names the block above it', async () => {
    const handle = await renderNote()
    expect(handle.revealHeading?.('^quote')).toBe(true)
    await expect.element(pmRoot.locate('.kore-block-flash')).toHaveTextContent('A table-like quote')
  })

  it('draws each end-of-line marker muted, and leaves a mid-line caret alone', async () => {
    await renderNote()
    const markers = [...document.querySelectorAll('.kore-block-id')].map((el) => el.textContent)
    expect(markers).toEqual(['^pro', '^quote'])
    await pmRoot.getByText('Last line').click()
    await userEvent.keyboard(' x^2 and ^tail')
    await expect.poll(() => document.querySelectorAll('.kore-block-id').length).toBe(3)
    expect(document.querySelectorAll('.kore-block-id')[2]?.textContent).toBe('^tail')
  })

  it('is false for an unknown id', async () => {
    const handle = await renderNote()
    expect(handle.revealHeading?.('^nope')).toBe(false)
    expect(document.querySelector('.kore-block-flash')).toBeNull()
  })

  it('steps out of a zoom that hides the line', async () => {
    const handle = await renderNote()
    await pmRoot.getByText('Other').click()
    await userEvent.keyboard(`{${mod}>}{Shift>}.{/Shift}{/${mod}}`)
    await expect.element(pmRoot.getByText('Last line')).not.toBeVisible()
    expect(handle.revealHeading?.('^pro')).toBe(true)
    await expect.element(pmRoot.getByText('Pro costs 49')).toBeVisible()
    await expect.element(pmRoot.getByText('Last line')).toBeVisible()
  })
})
