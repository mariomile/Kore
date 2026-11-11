import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LinkPreview } from '@kore/core'
import { Schema } from '@prosekit/pm/model'
import { EditorState } from '@prosekit/pm/state'
import { EditorView } from '@prosekit/pm/view'
import { createLinkCardPlugin, deliverLinkPreview, paragraphCardUrl } from './link-card-plugin'

/**
 * The editor's link cards over a real ProseMirror view: which lines become a
 * card, what the card draws, and the caret reveal that keeps the markdown
 * link editable. The schema mirrors meowdown's: the link is an `mdLinkText`
 * mark on the URL's own text.
 */

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*', toDOM: () => ['p', 0] },
    text: {},
  },
  marks: {
    mdLinkText: {
      attrs: { href: { default: '' } },
      toDOM: (mark) => ['a', { class: 'md-link', href: String(mark.attrs.href) }, 0],
    },
  },
})

const URL_X = 'https://x.com/grimcodes/status/1'
const URL_PAGE = 'https://www.ycombinator.com/library'

const PAGE: LinkPreview = {
  kind: 'page',
  url: URL_PAGE,
  title: 'Startup School',
  description: 'Some of the biggest companies of the next decade.',
  siteName: 'Y Combinator',
  provider: null,
  imageUrl: 'https://www.ycombinator.com/static/social.png',
  iconUrl: 'https://www.ycombinator.com/favicon.ico',
}

const POST: LinkPreview = {
  kind: 'post',
  url: URL_X,
  siteName: 'x.com',
  provider: 'x',
  iconUrl: null,
  imageUrl: null,
  authorName: 'grim',
  authorHandle: 'grimcodes',
  avatarUrl: null,
  publishedAt: '2026-11-05T09:30:00.000Z',
  text: 'Congrats to the team',
  replies: 28,
  reposts: 4,
  likes: 70,
}

function linkParagraph(url: string, text = url) {
  return schema.nodes.paragraph!.create(
    null,
    schema.text(text, [schema.marks.mdLinkText!.create({ href: url })]),
  )
}

function plainParagraph(text: string) {
  return schema.nodes.paragraph!.create(null, schema.text(text))
}

let view: EditorView | null = null

function mount(blocks: ReturnType<typeof plainParagraph>[]) {
  const request = vi.fn<(url: string, view: EditorView) => void>()
  const open = vi.fn<(url: string, event: MouseEvent) => void>()
  const host = document.createElement('div')
  host.className = 'kore-editor'
  document.body.append(host)
  view = new EditorView(host, {
    state: EditorState.create({
      doc: schema.nodes.doc!.create(null, blocks),
      plugins: [createLinkCardPlugin({ request, open })],
    }),
  })
  return { view, request, open, host }
}

afterEach(() => {
  view?.dom.parentElement?.remove()
  view?.destroy()
  view = null
})

describe('paragraphCardUrl', () => {
  it('takes only a paragraph that is one bare link', () => {
    expect(paragraphCardUrl(linkParagraph(URL_PAGE))).toBe(URL_PAGE)
    expect(paragraphCardUrl(linkParagraph(URL_PAGE, 'Y Combinator'))).toBe(null)
    expect(paragraphCardUrl(plainParagraph(URL_PAGE))).toBe(null)
    expect(paragraphCardUrl(plainParagraph('see the link'))).toBe(null)
  })
})

describe('link cards', () => {
  it('asks for each pasted link, and draws nothing until its preview arrives', () => {
    const { request, host } = mount([linkParagraph(URL_PAGE), plainParagraph('hello')])
    expect(request).toHaveBeenCalledWith(URL_PAGE, expect.anything())
    expect(host.querySelector('.kore-link-card')).toBe(null)
    expect(host.querySelector('a.md-link')?.closest('p')?.className ?? '').toBe('')
  })

  it('draws a page as title, description, site and image, and hides the raw link', () => {
    const { view, host } = mount([linkParagraph(URL_PAGE)])
    deliverLinkPreview(view, PAGE)
    const card = host.querySelector<HTMLElement>('.kore-link-card')
    expect(card?.dataset.kind).toBe('page')
    expect(card?.querySelector('.kore-link-card-title')?.textContent).toBe('Startup School')
    expect(card?.querySelector('.kore-link-card-description')?.textContent).toBe(PAGE.description)
    expect(card?.querySelector('.kore-link-card-site')?.textContent).toBe('Y Combinator')
    expect(card?.querySelector<HTMLImageElement>('.kore-link-card-thumb')?.src).toBe(PAGE.imageUrl)
    const source = host.querySelector('p')
    expect(source?.classList.contains('kore-link-card-source')).toBe(true)
    expect(source?.classList.contains('is-editing')).toBe(false)
  })

  it('draws an X post as the post, with its counts', () => {
    const { view, host } = mount([linkParagraph(URL_X)])
    deliverLinkPreview(view, POST)
    const card = host.querySelector<HTMLElement>('.kore-link-card')
    expect(card?.dataset.provider).toBe('x')
    expect(card?.querySelector('.kore-link-card-name')?.textContent).toBe('grim')
    expect(card?.querySelector('.kore-link-card-handle')?.textContent).toBe(
      '@grimcodes · 5 Nov 2026',
    )
    expect(card?.querySelector('.kore-link-card-text')?.textContent).toBe('Congrats to the team')
    expect(card?.querySelector('.kore-link-card-site')?.textContent).toBe(
      'x.com · 28 replies · 4 reposts · 70 likes',
    )
  })

  it('a plain click reveals the link for editing; a mod-click opens it', () => {
    const { view, host, open } = mount([plainParagraph('intro'), linkParagraph(URL_PAGE)])
    deliverLinkPreview(view, PAGE)
    const card = host.querySelector<HTMLElement>('.kore-link-card')!
    card.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, metaKey: true }))
    expect(open).toHaveBeenCalledWith(URL_PAGE, expect.any(MouseEvent))

    card.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    const paragraph = view.state.doc.child(1)
    expect(view.state.selection.from).toBe(
      view.state.doc.child(0).nodeSize + 1 + paragraph.content.size,
    )
    expect(host.querySelectorAll('p')[1]?.classList.contains('is-editing')).toBe(true)
  })

  it('stops being a card once the line is no longer a bare link', () => {
    const { view, host } = mount([linkParagraph(URL_PAGE)])
    deliverLinkPreview(view, PAGE)
    expect(host.querySelector('.kore-link-card')).not.toBe(null)
    const end = view.state.doc.content.size - 1
    view.dispatch(view.state.tr.insertText(' is great', end))
    expect(host.querySelector('.kore-link-card')).toBe(null)
  })
})
