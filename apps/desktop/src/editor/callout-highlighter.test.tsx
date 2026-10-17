import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import '@/test-utils/locator'
import { CalloutHighlighter } from './callout-highlighter'
import { NoteEditor, type NoteEditorHandle } from './note-editor'

const NOTE = 'intro\n\n> [!faq]- Why fold?\n> Because.\n\n> [!my-type]\n> Plain'

async function renderNote(): Promise<NoteEditorHandle> {
  let handle: NoteEditorHandle | null = null
  await render(
    <NoteEditor
      initialContent={NOTE}
      handleRef={(grabbed) => {
        handle = grabbed
      }}
    >
      <CalloutHighlighter />
    </NoteEditor>,
  )
  await expect.element(page.locate('blockquote[data-callout]').first()).toBeInTheDocument()
  return handle!
}

describe('CalloutHighlighter', () => {
  it('styles each callout by kind and folds without touching the markdown', async () => {
    const handle = await renderNote()
    const quotes = document.querySelectorAll('.ProseMirror blockquote')
    expect(quotes[0]).toHaveAttribute('data-callout', 'question')
    expect(quotes[0]).toHaveAttribute('data-callout-folded')
    // The `[!faq]-` token hides while the caret is elsewhere; the title stays.
    expect(quotes[0]?.querySelector('.kore-callout-marker')).not.toBeVisible()
    expect(quotes[0]).toHaveTextContent('Why fold?')
    // An unknown type is drawn as a note, titled after its token.
    expect(quotes[1]).toHaveAttribute('data-callout', 'note')
    expect(quotes[1]?.querySelector('.kore-callout-label')).toHaveTextContent('My-type')

    await page.getByRole('button', { name: 'Expand callout' }).click()
    await expect.poll(() => quotes[0]?.hasAttribute('data-callout-folded')).toBe(false)
    expect(handle.getMarkdown().trimEnd()).toBe(NOTE)
  })
})
