import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import '@/test-utils/locator'
import { ListZoom } from './list-zoom'
import { NoteEditor, type NoteEditorHandle } from './note-editor'

const NOTE = [
  '# Daily',
  '',
  '- DeepAgent #work',
  '  - call with [[Luca]]',
  '  - pricing #pricing',
  '- Buildrs',
  '',
].join('\n')

const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? 'Meta' : 'Control'
const pmRoot = page.locate('.ProseMirror')

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
      <ListZoom />
    </NoteEditor>,
  )
  await expect.element(pmRoot.getByText('Buildrs')).toBeVisible()
  return handle!
}

async function zoomIntoDeepAgent(): Promise<void> {
  await pmRoot.getByText('DeepAgent').click()
  await userEvent.keyboard(`{${mod}>}{Shift>}.{/Shift}{/${mod}}`)
  await expect.element(pmRoot.getByText('Buildrs')).not.toBeVisible()
}

describe('ListZoom', () => {
  it('shows only the zoomed branch, keeps tags live, and never rewrites the note', async () => {
    const onTagClick = vi.fn()
    const handle = await renderNote(onTagClick)
    await zoomIntoDeepAgent()

    await expect.element(pmRoot.locate('h1')).not.toBeVisible()
    await expect.element(pmRoot.getByText('call with')).toBeVisible()
    await expect.element(page.getByRole('navigation', { name: 'Zoomed list item' })).toBeVisible()
    expect(handle.getMarkdown()).toBe(NOTE)

    // Tags inside the branch still render and still open.
    await pmRoot.getByText('#pricing').click()
    await vi.waitFor(() => {
      expect(onTagClick).toHaveBeenCalledWith('pricing', expect.anything(), 4)
    })

    // Typing in the branch edits only that line of the file.
    await pmRoot.getByText('call with').click()
    await userEvent.keyboard(`{End} today`)
    await expect.poll(() => handle.getMarkdown()).toBe(NOTE.replace('[[Luca]]', '[[Luca]] today'))

    await page.getByRole('button', { name: 'Daily' }).click()
    await expect.element(pmRoot.getByText('Buildrs')).toBeVisible()
    await expect
      .element(page.getByRole('navigation', { name: 'Zoomed list item' }))
      .not.toBeInTheDocument()
    expect(handle.getMarkdown()).toBe(NOTE.replace('[[Luca]]', '[[Luca]] today'))
  })

  it('opens a first child on Enter at the end of the zoomed line', async () => {
    const handle = await renderNote()
    await zoomIntoDeepAgent()
    await pmRoot.getByText('DeepAgent').click()
    await userEvent.keyboard('{End}{Enter}idea')
    await expect
      .poll(() => handle.getMarkdown())
      .toBe(NOTE.replace('- DeepAgent #work\n', '- DeepAgent #work\n  - idea\n'))
    await expect.element(pmRoot.getByText('idea')).toBeVisible()

    await userEvent.keyboard(`{${mod}>}{Shift>},{/Shift}{/${mod}}`)
    await expect.element(pmRoot.getByText('Buildrs')).toBeVisible()
  })

  it('zooms with a modifier-click on a bullet', async () => {
    const handle = await renderNote()
    const marker = page.locate('.prosemirror-flat-list > .list-marker').first()
    await marker.click({ modifiers: [mod] })
    await expect.element(pmRoot.getByText('Buildrs')).not.toBeVisible()
    await expect.element(pmRoot.getByText('call with')).toBeVisible()
    expect(handle.getMarkdown()).toBe(NOTE)
  })
})
