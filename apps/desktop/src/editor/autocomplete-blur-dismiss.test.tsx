import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import '@/test-utils/locator'
import { AUTOCOMPLETE_BLUR_DISMISS_MS, AutocompleteBlurDismiss } from './autocomplete-blur-dismiss'
import { NoteEditor } from './note-editor'

const pmRoot = page.locate('.ProseMirror')
const heading1 = page.locate('[data-testid="slash-menu"] [value="Heading 1 h1"]')

async function openSlashMenu(): Promise<void> {
  await render(
    <NoteEditor initialContent="">
      <AutocompleteBlurDismiss />
    </NoteEditor>,
  )
  await pmRoot.click()
  // A key sent before WebKit moves focus into the editor never reaches it.
  await expect.element(pmRoot).toHaveFocus()
  await userEvent.keyboard('/heading')
  await expect.element(heading1).toBeVisible()
}

describe('AutocompleteBlurDismiss', () => {
  it('closes the open slash menu once the editor loses focus', async () => {
    await openSlashMenu()
    ;(document.activeElement as HTMLElement | null)?.blur()
    await expect
      .element(heading1, { timeout: AUTOCOMPLETE_BLUR_DISMISS_MS + 2000 })
      .not.toBeVisible()
    // The typed trigger stays in the note, as with Escape.
    expect(pmRoot.element().textContent).toContain('/heading')
  })

  it('leaves the menu open while the editor keeps focus', async () => {
    await openSlashMenu()
    await new Promise((resolve) => setTimeout(resolve, AUTOCOMPLETE_BLUR_DISMISS_MS + 200))
    await expect.element(heading1).toBeVisible()
  })
})
