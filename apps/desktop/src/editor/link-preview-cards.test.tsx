import { cleanup, render } from 'vitest-browser-react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LinkPreview } from '@reflect/core'

/**
 * The editor's link cards: which lines become one, what the card is handed,
 * and the privacy gate that decides whether the page is fetched at all.
 */

const loadLinkPreview = vi.hoisted(() => vi.fn<(url: string) => Promise<LinkPreview | null>>())
const editor = vi.hoisted(() => ({
  mounted: true,
  view: {
    dom: null as unknown as HTMLElement,
    domObserver: { stop: vi.fn(), start: vi.fn() },
  },
}))

const NativeMutationObserver = window.MutationObserver

class TestMutationObserver implements MutationObserver {
  static current: TestMutationObserver | null = null

  constructor(private readonly callback: MutationCallback) {
    TestMutationObserver.current = this
  }

  observe(): void {}
  disconnect(): void {}
  takeRecords(): MutationRecord[] {
    return []
  }

  trigger(): void {
    this.callback([], this)
  }
}

vi.mock('@meowdown/react', () => ({ useEditor: () => editor }))
vi.mock('@reflect/core', () => ({ loadLinkPreview }))

const { LinkPreviewCards } = await import('./link-preview-cards')

const PREVIEW: LinkPreview = {
  url: 'https://www.ycombinator.com/library',
  title: 'Startup School',
  description: 'Some of the biggest companies of the next decade.',
  siteName: 'Y Combinator',
  imageUrl: 'https://www.ycombinator.com/static/social.png',
}

function anchor(html: string): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = html
  editor.view.dom = root
  return root
}

beforeEach(() => {
  TestMutationObserver.current = null
  loadLinkPreview.mockReset().mockResolvedValue(PREVIEW)
  editor.view.domObserver.stop.mockClear()
  editor.view.domObserver.start.mockClear()
  vi.stubGlobal('MutationObserver', TestMutationObserver)
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe('LinkPreviewCards', () => {
  it('hands a pasted-URL line the page it describes', async () => {
    const root = anchor(
      '<p><a class="md-link" href="https://www.ycombinator.com/library">https://www.ycombinator.com/library</a></p>',
    )
    await render(<LinkPreviewCards enabled />)

    const link = root.querySelector('a')!
    await vi.waitFor(() => expect(link).toHaveAttribute('data-link-card', 'image'))
    expect(link).toHaveAttribute('data-link-card-title', 'Startup School')
    expect(link).toHaveAttribute('data-link-card-site', 'Y Combinator')
    expect(link.style.getPropertyValue('--link-card-image')).toBe(
      'url("https://www.ycombinator.com/static/social.png")',
    )
  })

  it('leaves a named link and a link inside a sentence alone', async () => {
    const root = anchor(
      '<p><a class="md-link" href="https://www.ycombinator.com/library">Startup School</a></p>' +
        '<p>Read <a class="md-link" href="https://example.com/post">https://example.com/post</a> later</p>',
    )
    await render(<LinkPreviewCards enabled />)

    await vi.waitFor(() => expect(loadLinkPreview).not.toHaveBeenCalled())
    for (const link of root.querySelectorAll('a')) {
      expect(link).not.toHaveAttribute('data-link-card')
    }
  })

  it('decorates the same URL twice without rewriting the first card', async () => {
    const url = 'https://www.ycombinator.com/library'
    const root = anchor(`<p><a class="md-link" href="${url}">${url}</a></p>`)
    await render(<LinkPreviewCards enabled />)

    const first = root.querySelector('a')!
    await vi.waitFor(() => expect(first).toHaveAttribute('data-link-card', 'image'))
    const mutations: MutationRecord[] = []
    const observer = new NativeMutationObserver((records) => {
      mutations.push(...records)
    })
    observer.observe(first, { attributes: true })

    root.insertAdjacentHTML('beforeend', `<p><a class="md-link" href="${url}">${url}</a></p>`)
    TestMutationObserver.current?.trigger()
    const second = root.querySelectorAll('a')[1]!
    await vi.waitFor(() => expect(second).toHaveAttribute('data-link-card', 'image'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mutations).toEqual([])
    expect(loadLinkPreview).toHaveBeenCalledTimes(1)
    expect(editor.view.domObserver.stop).toHaveBeenCalled()
    expect(editor.view.domObserver.start).toHaveBeenCalledTimes(
      editor.view.domObserver.stop.mock.calls.length,
    )
    observer.disconnect()
  })

  it('fetches nothing for a private note', async () => {
    const root = anchor(
      '<p><a class="md-link" href="https://www.ycombinator.com/library">https://www.ycombinator.com/library</a></p>',
    )
    await render(<LinkPreviewCards enabled={false} />)

    await vi.waitFor(() => expect(loadLinkPreview).not.toHaveBeenCalled())
    expect(root.querySelector('a')).not.toHaveAttribute('data-link-card')
  })
})
