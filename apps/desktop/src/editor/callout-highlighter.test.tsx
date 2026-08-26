import { cleanup, render } from 'vitest-browser-react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NoteEditor } from './note-editor'
import { CalloutHighlighter } from './callout-highlighter'

const observe = vi.fn()
const disconnect = vi.fn()

class TestMutationObserver {
  observe = observe
  disconnect = disconnect
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  cleanup()
})

describe('CalloutHighlighter', () => {
  it('observes only its own editor instead of the whole document', async () => {
    vi.stubGlobal('MutationObserver', TestMutationObserver)
    const view = await render(
      <NoteEditor initialContent="> [!NOTE] Local">
        <CalloutHighlighter />
      </NoteEditor>,
    )

    const editor = view.container.querySelector('.ProseMirror')
    expect(editor).not.toBeNull()
    await vi.waitFor(() => expect(observe).toHaveBeenCalled())
    expect(observe).toHaveBeenCalledWith(editor, {
      subtree: true,
      childList: true,
      characterData: true,
    })
    expect(observe).not.toHaveBeenCalledWith(document.body, expect.anything())
  })
})
