import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import '@/test-utils/locator'
import { hover, unhover } from '@/test-utils/mouse'
import { BlockZoom } from './block-zoom'
import { NoteEditor, type NoteEditorHandle } from './note-editor'
import { PageBlocks } from './page-blocks'

/**
 * Sub pages as Craft's page blocks: a list item marked `^page-…` stays in its
 * note with its children, reads as one card (title plus what it says), and a
 * tap zooms into it, where it reads as ordinary blocks again.
 */

const NOTE = [
  '- Groceries',
  '- Trip to Lisbon ^page-a1b2c3',
  '  - Book the flight',
  '  - **Hotel** near [[Alfama]]',
  '  - Packing ^page-d4e5f6',
  '    - Passport',
  '- Empty one ^page-g7h8i9',
  '- After',
  '',
].join('\n')

const pmRoot = page.locate('.ProseMirror')
const cards = page.locate('.kore-page-card')

function clickGrip(element: Element): void {
  const pointer = { bubbles: true, cancelable: true, isPrimary: true, pointerId: 1 }
  element.dispatchEvent(new PointerEvent('pointerdown', { ...pointer, button: 0, buttons: 1 }))
  element.dispatchEvent(new PointerEvent('pointerup', { ...pointer, button: 0, buttons: 0 }))
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, cancelable: true }))
}

async function renderNote(content = NOTE, blockHandle = false): Promise<NoteEditorHandle> {
  let handle: NoteEditorHandle | null = null
  await render(
    <NoteEditor
      initialContent={content}
      blockHandle={blockHandle}
      handleRef={(grabbed) => {
        handle = grabbed
      }}
    >
      <BlockZoom />
      <PageBlocks />
    </NoteEditor>,
  )
  await expect.element(pmRoot.getByText(content.split('\n')[0]!.slice(2, 8))).toBeVisible()
  return handle!
}

describe('PageBlocks', () => {
  it('draws a page as one card with its title and a preview, and leaves the file alone', async () => {
    const handle = await renderNote()
    // Two cards: the nested "Packing" page folds into its parent's card.
    await expect.poll(() => cards.elements().length).toBe(2)
    const trip = cards.elements()[0]!
    expect(trip.querySelector('.kore-page-card-title')?.textContent).toBe('Trip to Lisbon')
    // The preview is the page's skeleton: one line per block with its kind
    // and depth (a nested page shows as one line; its children stay inside).
    const lines = [...trip.querySelectorAll<HTMLElement>('.kore-page-card-line')].map(
      (line) =>
        `${line.dataset['kind']}:${line.style.getPropertyValue('--depth')}:${line.textContent}`,
    )
    expect(lines).toEqual([
      'bullet:0:Book the flight',
      'bullet:0:Hotel near Alfama',
      'page:0:Packing',
    ])
    // The thumbnail draws the same rows in miniature.
    expect(
      [...trip.querySelectorAll<HTMLElement>('.kore-page-skel')].map((row) => row.dataset['kind']),
    ).toEqual(['bullet', 'bullet', 'page'])
    const empty = cards.elements()[1]!
    expect(empty.querySelector('.kore-page-card-title')?.textContent).toBe('Empty one')
    expect(empty.querySelector('.kore-page-card-excerpt')?.textContent).toBe('Empty page')
    // The item's own text sits behind the card.
    const hidden = [...pmRoot.element().querySelectorAll('p')].find(
      (line) => line.textContent === 'Book the flight',
    )
    expect(hidden?.offsetParent).toBeNull()
    await expect.element(pmRoot.getByText('After')).toBeVisible()
    expect(handle.getMarkdown()).toBe(NOTE)
  })

  it('zooms into a page on tap, where it reads as blocks and nested pages are cards', async () => {
    const handle = await renderNote()
    await expect.poll(() => cards.elements().length).toBe(2)
    ;(cards.elements()[0] as HTMLElement).click()

    await expect.element(pmRoot.getByText('Book the flight', { exact: true })).toBeVisible()
    await expect.element(pmRoot.getByText('Groceries')).not.toBeVisible()
    // Inside the zoom the nested page is the one card left in view.
    const shown = (): HTMLElement[] =>
      (cards.elements() as HTMLElement[]).filter((card) => card.offsetParent !== null)
    await expect.poll(() => shown().length).toBe(1)
    expect(shown()[0]!.querySelector('.kore-page-card-title')?.textContent).toBe('Packing')
    const passport = [...pmRoot.element().querySelectorAll('p')].find(
      (line) => line.textContent === 'Passport',
    )
    expect(passport?.offsetParent).toBeNull()
    expect(handle.getMarkdown()).toBe(NOTE)
  })

  it('keeps the caret out of a collapsed page', async () => {
    const handle = await renderNote()
    await expect.poll(() => cards.elements().length).toBe(2)
    // A caret placed inside the hidden text moves past the page, and past
    // the empty page right after it, to the next line a reader can see.
    handle.focus()
    handle.setSelection({ type: 'text', anchor: 20, head: 20 })
    await expect.poll(() => window.getSelection()?.anchorNode?.textContent ?? '').toBe('After')
    expect(handle.getMarkdown()).toBe(NOTE)
  })

  it('opens the page a followed block link points into', async () => {
    const handle = await renderNote()
    await expect.poll(() => cards.elements().length).toBe(2)
    expect(handle.revealHeading?.('^page-d4e5f6')).toBe(true)
    // "Packing" sits inside "Trip to Lisbon": the link opens Packing itself.
    await expect.element(pmRoot.getByText('Passport', { exact: true })).toBeVisible()
    await expect.element(pmRoot.getByText('Groceries')).not.toBeVisible()
    expect(handle.getMarkdown()).toBe(NOTE)
  })

  it('selects a card instead of joining text into it', async () => {
    const handle = await renderNote()
    await expect.poll(() => cards.elements().length).toBe(2)
    handle.focus()
    // Backspace at the start of "After" would pull it into the hidden page.
    const walker = document.createTreeWalker(pmRoot.element(), NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node !== null && node.textContent !== 'After') node = walker.nextNode()
    document.getSelection()?.collapse(node, 0)
    await new Promise((resolve) => setTimeout(resolve, 50))
    await userEvent.keyboard('{Backspace}')
    await expect
      .poll(() => document.querySelector('.ProseMirror-selectednode')?.textContent ?? '')
      .toContain('Empty one')
    expect(handle.getMarkdown()).toBe(NOTE)

    // Delete at the end of "Groceries" would pull the page's title up.
    const top = document.createTreeWalker(pmRoot.element(), NodeFilter.SHOW_TEXT)
    let groceries = top.nextNode()
    while (groceries !== null && groceries.textContent !== 'Groceries') groceries = top.nextNode()
    document.getSelection()?.collapse(groceries, 'Groceries'.length)
    await new Promise((resolve) => setTimeout(resolve, 50))
    await userEvent.keyboard('{Delete}')
    await expect
      .poll(() => document.querySelector('.ProseMirror-selectednode')?.textContent ?? '')
      .toContain('Trip to Lisbon')
    expect(handle.getMarkdown()).toBe(NOTE)
  })

  it('turns a block into a page from the Mac block menu, and back', async () => {
    await unhover()
    const handle = await renderNote('Trip notes\n\n- after\n', true)
    const menu = page.getByTestId('block-handle-menu')
    const grip = page.getByTestId('block-handle-drag')
    await hover(pmRoot.getByText('Trip notes'))
    await expect.element(grip).toBeVisible()
    clickGrip(grip.element())
    await menu.getByRole('menuitem', { name: 'Turn into' }).hover()
    await page.getByRole('menuitem', { name: 'Page', exact: true }).click()
    await expect.poll(() => handle.getMarkdown()).toMatch(/^- Trip notes \^page-[\da-z]{6}\n/)
    await expect.poll(() => cards.elements().length).toBe(1)

    await unhover()
    await hover(page.locate('.kore-page-card'))
    await expect.element(grip).toBeVisible()
    clickGrip(grip.element())
    await expect.element(menu.getByRole('menuitem', { name: 'Open page' })).toBeVisible()
    await menu.getByRole('menuitem', { name: 'Turn into' }).hover()
    await page.getByRole('menuitem', { name: 'Text', exact: true }).click()
    await expect.poll(() => handle.getMarkdown()).toBe('Trip notes\n\n- after\n')
  })

  it('turns the caret block into a page with ⌥⌘P', async () => {
    const handle = await renderNote('- Groceries\n  - Milk\n- After\n')
    handle.focus()
    handle.setSelection({ type: 'text', anchor: 4, head: 4 })
    const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? 'Meta' : 'Control'
    await userEvent.keyboard(`{${mod}>}{Alt>}p{/Alt}{/${mod}}`)
    await expect.poll(() => handle.getMarkdown()).toMatch(/^- Groceries \^page-[\da-z]{6}\n {2}- Milk\n/)
    await expect.poll(() => cards.elements().length).toBe(1)
    // The caret leaves the card for the next line a reader can see, where the
    // `/` menu's row (the same toggle) would make that line a page.
    await expect.poll(() => window.getSelection()?.anchorNode?.textContent ?? '').toBe('After')
  })
})
