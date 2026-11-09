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

  it('never shows an id in the note', async () => {
    await renderNote()
    await expect.element(pmRoot.getByText('Pro costs 49')).toBeVisible()
    expect((pmRoot.element() as HTMLElement).innerText).not.toContain('^')
    expect(document.querySelector('.kore-block-id')?.textContent).toBe(' ^pro')
    expect(document.querySelector('.kore-block-id-line')?.textContent).toBe('^quote')
  })

  it('typing at the end of a line goes before its id', async () => {
    const handle = await renderNote()
    await pmRoot.getByText('Pro costs 49').click()
    await userEvent.keyboard('{End}€ a month')
    await expect.poll(() => handle.getMarkdown()).toContain('  - Pro costs 49€ a month ^pro\n')
  })

  it('Enter at the end of a line leaves the id on that line', async () => {
    const handle = await renderNote()
    await pmRoot.getByText('Other').click()
    await userEvent.keyboard('{End}{Enter}Third')
    await expect.poll(() => handle.getMarkdown()).toContain('- Other\n- Third')
    expect(handle.getMarkdown()).toContain('  - Pro costs 49 ^pro\n')
    await pmRoot.getByText('Pro costs 49').click()
    await userEvent.keyboard('{End}{Enter}Team')
    await expect.poll(() => handle.getMarkdown()).toContain('Team')
    expect(handle.getMarkdown()).toMatch(/- Pro costs 49 \^pro\n/)
    expect(handle.getMarkdown()).not.toMatch(/Team \^pro/)
  })

  it('Delete at the end of a line keeps the id at the end of the joined line', async () => {
    const note = ['Para one ^one', 'still para', '', 'Last line', ''].join('\n')
    const handle = await renderNote(note.replace('^one\nstill para', '^one\n\nstill para'))
    await pmRoot.getByText('Para one').click()
    await userEvent.keyboard('{End}{Delete}')
    await expect.poll(() => handle.getMarkdown()).toContain('Para onestill para ^one')
    await userEvent.keyboard('X')
    await expect.poll(() => handle.getMarkdown()).toContain('Para oneXstill para ^one')
  })

  it('Backspace at the start of the next line keeps the id at the end of the joined line', async () => {
    const note = ['foo ^abc', 'bar', '', 'Last line', '']
      .join('\n')
      .replace('^abc\nbar', '^abc\n\nbar')
    const handle = await renderNote(note)
    await pmRoot.getByText('bar', { exact: true }).click()
    await userEvent.keyboard('{Home}')
    await userEvent.keyboard('{Backspace}')
    await expect.poll(() => handle.getMarkdown()).toContain('foobar ^abc')
    await expect.element(pmRoot.getByText('foobar')).toBeVisible()
  })

  it('Backspace under a hidden id-only line does not join into it', async () => {
    const handle = await renderNote()
    await pmRoot.getByText('Last line').click()
    await userEvent.keyboard('{Home}')
    await userEvent.keyboard('{Backspace}')
    await userEvent.keyboard('X')
    await expect.poll(() => handle.getMarkdown()).toContain('A table-like quoteX')
    expect(handle.getMarkdown()).toContain('\n^quote\n\nLast line')
  })

  it('labels [[Note#^id]] with the note name only', async () => {
    const note = [
      'See [[Pricing#^pro]] and [[#^quote]] and [[Pricing#^pro|the price]].',
      '',
      'Last line',
      '',
    ].join('\n')
    await renderNote(note)
    const labels = [...document.querySelectorAll('.md-wikilink-view-label')].map(
      (el) => el.textContent,
    )
    expect(labels).toEqual(['Pricing', 'Link to line', 'the price'])
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
