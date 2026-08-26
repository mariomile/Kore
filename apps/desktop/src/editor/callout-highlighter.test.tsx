import { cleanup, render } from 'vitest-browser-react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const observe = vi.fn()
const disconnect = vi.fn()
const editor = vi.hoisted(() => ({
  mounted: true,
  view: {
    dom: null as unknown as HTMLElement,
  },
}))

class TestMutationObserver implements MutationObserver {
  observe(target: Node, options?: MutationObserverInit): void {
    observe(target, options)
  }

  disconnect(): void {
    disconnect()
  }

  takeRecords(): MutationRecord[] {
    return []
  }
}

vi.mock('@meowdown/react', () => ({
  useEditor: () => editor,
}))

const { CalloutHighlighter } = await import('./callout-highlighter')

beforeEach(() => {
  editor.view.dom = document.createElement('div')
  editor.view.dom.innerHTML = '<blockquote>&gt; [!NOTE] Local</blockquote>'
  vi.stubGlobal('MutationObserver', TestMutationObserver)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  cleanup()
})

describe('CalloutHighlighter', () => {
  it('observes only its own editor instead of the whole document', async () => {
    await render(<CalloutHighlighter />)

    await vi.waitFor(() => expect(observe).toHaveBeenCalled())
    expect(observe).toHaveBeenCalledWith(editor.view.dom, {
      subtree: true,
      childList: true,
      characterData: true,
    })
    expect(observe).not.toHaveBeenCalledWith(document.body, expect.anything())
    expect(editor.view.dom.querySelector('blockquote')).toHaveAttribute('data-callout', 'note')
  })
})
