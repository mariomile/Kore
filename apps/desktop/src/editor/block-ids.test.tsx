import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import '@/test-utils/locator'
import { BlockIds } from './block-ids'
import { lastFocusedBlockIdView } from './block-id-plugin'
import { BlockZoom } from './block-zoom'
import { copyLinkToBlock, copyLinkToLastFocusedLine } from './copy-block-link'
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

async function renderNote(
  content = NOTE,
  linkTarget: string | null = 'Pricing',
): Promise<NoteEditorHandle> {
  let handle: NoteEditorHandle | null = null
  await render(
    <NoteEditor
      initialContent={content}
      handleRef={(grabbed) => {
        handle = grabbed
      }}
    >
      <BlockZoom />
      <BlockIds linkTarget={linkTarget} />
    </NoteEditor>,
  )
  await expect.element(pmRoot.getByText('Last line')).toBeVisible()
  return handle!
}

function stubClipboard(): ReturnType<typeof vi.fn> {
  const writeText = vi.fn(() => Promise.resolve())
  vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(writeText)
  return writeText
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

  it('copy link to line adds an id to that line only and copies [[Note#^id]]', async () => {
    const writeText = stubClipboard()
    const handle = await renderNote()
    await pmRoot.getByText('Other').click()
    expect(copyLinkToLastFocusedLine()).toBe(true)
    await expect.poll(() => writeText.mock.calls.length).toBe(1)
    const id = /- Other \^([a-z0-9]{6})\n/.exec(handle.getMarkdown())?.[1]
    expect(id).toBeDefined()
    expect(writeText).toHaveBeenCalledWith(`[[Pricing#^${id}]]`)
    expect(handle.getMarkdown()).toBe(NOTE.replace('- Other', `- Other ^${id}`))
  })

  it("reuses a line's existing id", async () => {
    const writeText = stubClipboard()
    const handle = await renderNote()
    await pmRoot.getByText('Pro costs 49').click()
    expect(copyLinkToLastFocusedLine()).toBe(true)
    await expect.poll(() => writeText.mock.calls.length).toBe(1)
    expect(writeText).toHaveBeenCalledWith('[[Pricing#^pro]]')
    expect(handle.getMarkdown()).toBe(NOTE)
  })

  it('ids a code block from a line of its own under it', async () => {
    const writeText = stubClipboard()
    const note = ['```js', 'const a = 1', '```', '', 'Last line', ''].join('\n')
    const handle = await renderNote(note)
    await pmRoot.getByText('Last line').click()
    const view = lastFocusedBlockIdView()!
    expect(await copyLinkToBlock(view, 0)).toBe(true)
    const id = /```\n\n\^([a-z0-9]{6})\n/.exec(handle.getMarkdown())?.[1]
    expect(id).toBeDefined()
    expect(writeText).toHaveBeenCalledWith(`[[Pricing#^${id}]]`)
    // A second copy finds the id it added.
    expect(await copyLinkToBlock(lastFocusedBlockIdView()!, 0)).toBe(true)
    expect(writeText).toHaveBeenLastCalledWith(`[[Pricing#^${id}]]`)
  })

  it('offers nothing before the note has a link target', async () => {
    const writeText = stubClipboard()
    const handle = await renderNote(NOTE, null)
    await pmRoot.getByText('Other').click()
    expect(copyLinkToLastFocusedLine()).toBe(false)
    expect(writeText).not.toHaveBeenCalled()
    expect(handle.getMarkdown()).toBe(NOTE)
  })
})
