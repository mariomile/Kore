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
  view: { dom: null as unknown as HTMLElement },
}))

class TestMutationObserver implements MutationObserver {
  observe(): void {}
  disconnect(): void {}
  takeRecords(): MutationRecord[] {
    return []
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
  loadLinkPreview.mockReset().mockResolvedValue(PREVIEW)
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

  it('fetches nothing for a private note', async () => {
    const root = anchor(
      '<p><a class="md-link" href="https://www.ycombinator.com/library">https://www.ycombinator.com/library</a></p>',
    )
    await render(<LinkPreviewCards enabled={false} />)

    await vi.waitFor(() => expect(loadLinkPreview).not.toHaveBeenCalled())
    expect(root.querySelector('a')).not.toHaveAttribute('data-link-card')
  })
})
