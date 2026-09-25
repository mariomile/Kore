import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import '@/test-utils/locator'
import { CollectionFenceGuard } from './collection-fence-guard'
import { NoteEditor, type NoteEditorHandle } from './note-editor'

const pmRoot = page.locate('.ProseMirror')
const NOTE = 'before\n\n```collection\ntag: area\n```\n\nafter'

function anchorOf(handle: NoteEditorHandle): number | null {
  const selection = handle.getSelection?.()
  return selection?.type === 'text' ? selection.anchor : null
}

async function renderNote(): Promise<NoteEditorHandle> {
  let handle: NoteEditorHandle | null = null
  await render(
    <NoteEditor
      initialContent={NOTE}
      renderCodeBlock={({ language }) =>
        language === 'collection' ? <div data-testid="fake-collection">widget</div> : null
      }
      handleRef={(grabbed) => {
        handle = grabbed
      }}
    >
      <CollectionFenceGuard />
    </NoteEditor>,
  )
  await expect.element(page.getByTestId('fake-collection')).toBeInTheDocument()
  return handle!
}

describe('CollectionFenceGuard', () => {
  it('jumps over the fence when the caret moves down into it', async () => {
    const handle = await renderNote()
    handle.setSelection({ type: 'text', anchor: 7, head: 7 })
    await pmRoot.click()
    // A key sent before WebKit moves focus into the editor never reaches it.
    await expect.element(pmRoot).toHaveFocus()
    handle.setSelection({ type: 'text', anchor: 7, head: 7 })
    await userEvent.keyboard('{ArrowDown}')
    // Positions 20–25 are the "after" paragraph; the fence spans 8–19.
    await expect.poll(() => anchorOf(handle)).toBeGreaterThanOrEqual(20)
  })

  it('jumps over the fence when the caret moves up into it', async () => {
    const handle = await renderNote()
    await pmRoot.click()
    // A key sent before WebKit moves focus into the editor never reaches it.
    await expect.element(pmRoot).toHaveFocus()
    handle.setSelection({ type: 'text', anchor: 22, head: 22 })
    await userEvent.keyboard('{ArrowUp}')
    // Positions 1–7 are the "before" paragraph.
    await expect.poll(() => anchorOf(handle)).toBeLessThanOrEqual(7)
  })
})
