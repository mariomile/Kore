import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import '@/test-utils/locator'
import { hover, unhover } from '@/test-utils/mouse'
import { BlockZoom } from './block-zoom'
import { NoteEditor, type NoteEditorHandle } from './note-editor'

const NOTE = [
  '# Daily',
  '',
  '## Work',
  '',
  'Intro paragraph',
  '',
  '- DeepAgent #work',
  '  - call with [[Luca]]',
  '  - pricing #pricing',
  '- Buildrs',
  '',
  '### Calls',
  '',
  'Call notes',
  '',
  '## Home',
  '',
  'Groceries',
  '',
].join('\n')

const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? 'Meta' : 'Control'
const zoomIn = `{${mod}>}{Shift>}.{/Shift}{/${mod}}`
const zoomOut = `{${mod}>}{Shift>},{/Shift}{/${mod}}`
const pmRoot = page.locate('.ProseMirror')
const breadcrumb = page.getByRole('navigation', { name: 'Zoomed block' })

/** Put the caret `offset` characters into the text node that starts with `text`. */
async function placeCaret(text: string, offset: number): Promise<void> {
  const root = pmRoot.element()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node.textContent?.startsWith(text) === true) {
      document.getSelection()?.collapse(node, offset)
      // ProseMirror reads the DOM selection on selectionchange.
      await new Promise((resolve) => setTimeout(resolve, 50))
      return
    }
  }
  throw new Error(`no text node starts with ${text}`)
}

async function renderNote(onTagClick = vi.fn(), blockHandle = false): Promise<NoteEditorHandle> {
  let handle: NoteEditorHandle | null = null
  await render(
    <NoteEditor
      initialContent={NOTE}
      blockHandle={blockHandle}
      onTagClick={onTagClick}
      handleRef={(grabbed) => {
        handle = grabbed
      }}
    >
      <BlockZoom />
    </NoteEditor>,
  )
  await expect.element(pmRoot.getByText('Groceries')).toBeVisible()
  return handle!
}

describe('BlockZoom', () => {
  it('zooms a list item to its branch, keeps tags live, and never rewrites the note', async () => {
    const onTagClick = vi.fn()
    const handle = await renderNote(onTagClick)
    await pmRoot.getByText('DeepAgent').click()
    await userEvent.keyboard(zoomIn)

    await expect.element(pmRoot.getByText('Buildrs')).not.toBeVisible()
    await expect.element(pmRoot.getByText('Intro paragraph')).not.toBeVisible()
    await expect.element(pmRoot.getByText('call with')).toBeVisible()
    await expect.element(breadcrumb.getByRole('button', { name: 'Work' })).toBeVisible()
    expect(handle.getMarkdown()).toBe(NOTE)

    // Tags inside the branch still render and still open.
    await pmRoot.getByText('#pricing').click()
    await vi.waitFor(() => {
      expect(onTagClick).toHaveBeenCalledWith('pricing', expect.anything(), 8)
    })

    // Typing in the branch edits only that line of the file.
    await pmRoot.getByText('call with').click()
    await userEvent.keyboard('{End} today')
    const edited = NOTE.replace('[[Luca]]', '[[Luca]] today')
    await expect.poll(() => handle.getMarkdown()).toBe(edited)

    await breadcrumb.getByRole('button', { name: 'Daily' }).click()
    await expect.element(pmRoot.getByText('Groceries')).toBeVisible()
    await expect.element(breadcrumb).not.toBeInTheDocument()
    expect(handle.getMarkdown()).toBe(edited)
  })

  it('opens a first child on Enter at the end of the zoomed item', async () => {
    const handle = await renderNote()
    await pmRoot.getByText('DeepAgent').click()
    await userEvent.keyboard(zoomIn)
    await pmRoot.getByText('DeepAgent').click()
    await userEvent.keyboard('{End}{Enter}idea')
    await expect
      .poll(() => handle.getMarkdown())
      .toBe(NOTE.replace('- DeepAgent #work\n', '- DeepAgent #work\n  - idea\n'))
    await expect.element(pmRoot.getByText('idea')).toBeVisible()
  })

  it('zooms a heading to its section and steps out section by section', async () => {
    const handle = await renderNote()
    await pmRoot.getByText('Calls', { exact: true }).click()
    await userEvent.keyboard(zoomIn)
    await expect.element(pmRoot.getByText('Call notes')).toBeVisible()
    await expect.element(pmRoot.getByText('Intro paragraph')).not.toBeVisible()
    await expect.element(pmRoot.getByText('Groceries')).not.toBeVisible()

    await userEvent.keyboard(zoomOut)
    await expect.element(pmRoot.getByText('Intro paragraph')).toBeVisible()
    await expect.element(pmRoot.getByText('Call notes')).toBeVisible()
    await expect.element(pmRoot.getByText('Groceries')).not.toBeVisible()

    // Escape steps out too, once there is no selection to collapse.
    await userEvent.keyboard('{Escape}')
    await expect.element(pmRoot.getByText('Groceries')).toBeVisible()
    expect(handle.getMarkdown()).toBe(NOTE)
    // The zoom animation leaves no transition names behind.
    await expect
      .poll(() => document.querySelectorAll('[style*="view-transition-name"]').length)
      .toBe(0)
  })

  it('zooms a paragraph alone and keeps a new paragraph from Enter in view', async () => {
    const handle = await renderNote()
    await pmRoot.getByText('Intro paragraph').click()
    await userEvent.keyboard(zoomIn)
    await expect.element(pmRoot.getByText('DeepAgent')).not.toBeVisible()
    await userEvent.keyboard('{End}{Enter}Second line')
    await expect.element(pmRoot.getByText('Second line')).toBeVisible()
    await expect
      .poll(() => handle.getMarkdown())
      .toBe(NOTE.replace('Intro paragraph\n', 'Intro paragraph\n\nSecond line\n'))
  })

  it('refuses edits that would move content out of view', async () => {
    const handle = await renderNote()
    await pmRoot.getByText('DeepAgent').click()
    await userEvent.keyboard(zoomIn)

    // Outdenting a direct child would make it a hidden sibling.
    await pmRoot.getByText('call with').click()
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
    // Enter on an empty child would outdent it the same way.
    await pmRoot.getByText(/^pricing /).click()
    await userEvent.keyboard('{End}{Enter}{Enter}kept')
    await expect.element(pmRoot.getByText('kept')).toBeVisible()
    await expect.element(pmRoot.getByText('call with')).toBeVisible()

    // Select-all and delete stays inside the branch.
    await userEvent.keyboard(`{${mod}>}a{/${mod}}{Backspace}`)
    await userEvent.keyboard(zoomOut)
    await expect.element(pmRoot.getByText('Buildrs')).toBeVisible()
    await expect.element(pmRoot.getByText('Intro paragraph')).toBeVisible()
    expect(handle.getMarkdown()).toContain('- Buildrs\n')
    expect(handle.getMarkdown()).not.toContain('call with')
  })

  it('keeps the last block of a section zoom from moving past its end', async () => {
    const handle = await renderNote()
    await pmRoot.getByText('Calls', { exact: true }).click()
    await userEvent.keyboard(zoomIn)
    await pmRoot.getByText('Call notes').click()
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}')
    await expect.element(pmRoot.getByText('Call notes')).toBeVisible()
    expect(handle.getMarkdown()).toBe(NOTE)
  })

  it('ends the zoom when the note is reloaded from disk', async () => {
    const handle = await renderNote()
    await pmRoot.getByText('DeepAgent').click()
    await userEvent.keyboard(zoomIn)
    await expect.element(breadcrumb).toBeVisible()
    handle.setMarkdown(NOTE.replace('Groceries', 'Groceries and wine'))
    await expect.element(breadcrumb).not.toBeInTheDocument()
    await expect.element(pmRoot.getByText('Groceries and wine')).toBeVisible()
  })

  it('jumps to a middle crumb', async () => {
    await renderNote()
    await pmRoot.getByText('call with').click()
    await userEvent.keyboard(zoomIn)
    await expect.element(pmRoot.getByText(/^pricing /)).not.toBeVisible()
    await breadcrumb.getByRole('button', { name: 'Work', exact: true }).click()
    await expect.element(pmRoot.getByText('Intro paragraph')).toBeVisible()
    await expect.element(pmRoot.getByText('Groceries')).not.toBeVisible()
  })

  it('splits the zoomed line into a first child on a mid-line Enter', async () => {
    const handle = await renderNote()
    await pmRoot.getByText('DeepAgent').click()
    await userEvent.keyboard(zoomIn)
    await pmRoot.getByText('DeepAgent').click()
    await placeCaret('DeepAgent', 4)
    await userEvent.keyboard('{Enter}')
    await expect
      .poll(() => handle.getMarkdown())
      .toBe(NOTE.replace('- DeepAgent #work\n', '- Deep\n  - Agent #work\n'))
  })

  it('zooms with a modifier-click on a bullet', async () => {
    const handle = await renderNote()
    await page
      .locate('.prosemirror-flat-list > .list-marker')
      .first()
      .click({ modifiers: [mod] })
    await expect.element(pmRoot.getByText('Buildrs')).not.toBeVisible()
    await expect.element(pmRoot.getByText('call with')).toBeVisible()
    expect(handle.getMarkdown()).toBe(NOTE)
  })

  it('finds the Meowdown list DOM the zoom styles and clicks rely on', async () => {
    // A guard on third-party markup: block-zoom.css and the bullet click use these.
    await renderNote()
    const item = page.locate('.prosemirror-flat-list[data-list-kind="bullet"]').first()
    await expect.element(item.locate('> .list-marker')).toBeInTheDocument()
    await expect.element(item.locate('> .list-content')).toBeInTheDocument()
    await item.locate('> .list-marker').click()
    await expect.element(item).toHaveAttribute('data-list-collapsed')
  })

  it('hides the block handle on the zoomed item, not on its children', async () => {
    await renderNote()
    await pmRoot.getByText('DeepAgent').click()
    await userEvent.keyboard(zoomIn)
    const host = pmRoot.element().parentElement
    await pmRoot.getByText('DeepAgent').hover()
    await vi.waitFor(() => expect(host?.hasAttribute('data-zoom-over-root')).toBe(true))
    await pmRoot.getByText('call with').hover()
    await vi.waitFor(() => expect(host?.hasAttribute('data-zoom-over-root')).toBe(false))
  })

  it('zooms from the block menu', async () => {
    await unhover()
    await renderNote(vi.fn(), true)
    await hover(pmRoot.getByText('Intro paragraph'))
    const grip = page.getByTestId('block-handle-drag')
    await expect.element(grip).toBeVisible()
    clickGrip(grip.element())
    await page.getByTestId('block-handle-menu').getByRole('menuitem', { name: 'Zoom in' }).click()
    await expect.element(pmRoot.getByText('Groceries')).not.toBeVisible()
    await expect.element(pmRoot.getByText('Intro paragraph')).toBeVisible()
  })
})

function clickGrip(element: Element): void {
  const pointer = { bubbles: true, cancelable: true, isPrimary: true, pointerId: 1 }
  element.dispatchEvent(new PointerEvent('pointerdown', { ...pointer, button: 0, buttons: 1 }))
  element.dispatchEvent(new PointerEvent('pointerup', { ...pointer, button: 0, buttons: 0 }))
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, cancelable: true }))
}
