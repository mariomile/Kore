import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import '@/test-utils/locator'
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

async function renderNote(onTagClick = vi.fn()): Promise<NoteEditorHandle> {
  let handle: NoteEditorHandle | null = null
  await render(
    <NoteEditor
      initialContent={NOTE}
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

    await userEvent.keyboard(zoomOut)
    await expect.element(pmRoot.getByText('Groceries')).toBeVisible()
    expect(handle.getMarkdown()).toBe(NOTE)
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
})
