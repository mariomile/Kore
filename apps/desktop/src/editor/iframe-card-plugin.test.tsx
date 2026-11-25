import { afterEach, describe, expect, it } from 'vitest'
import { Schema } from '@prosekit/pm/model'
import { EditorState } from '@prosekit/pm/state'
import { EditorView } from '@prosekit/pm/view'
import { createIframeCardPlugin, paragraphIframe } from './iframe-card-plugin'

/**
 * Pasted iframes over a real ProseMirror view. Meowdown has no HTML block,
 * so a pasted `<iframe>` is a paragraph of plain text, as here.
 */

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*', toDOM: () => ['p', 0] },
    text: {},
  },
})

const MAP = 'https://www.openstreetmap.org/export/embed.html?bbox=12.4,41.8,12.6,42.0'

function paragraph(text: string) {
  return schema.nodes.paragraph!.create(null, schema.text(text))
}

let view: EditorView | null = null
const opened: string[] = []

function mount(blocks: ReturnType<typeof paragraph>[]) {
  const host = document.createElement('div')
  host.className = 'kore-editor'
  document.body.append(host)
  view = new EditorView(host, {
    state: EditorState.create({
      doc: schema.nodes.doc!.create(null, blocks),
      plugins: [
        createIframeCardPlugin({
          open: (url) => {
            opened.push(url)
          },
        }),
      ],
    }),
  })
  return { view, host }
}

afterEach(() => {
  view?.dom.parentElement?.remove()
  view?.destroy()
  view = null
  opened.length = 0
})

describe('paragraphIframe', () => {
  it('takes only a paragraph that is one https iframe', () => {
    expect(paragraphIframe(paragraph(`<iframe src="${MAP}"></iframe>`))?.player.url).toBe(MAP)
    expect(paragraphIframe(paragraph(`see <iframe src="${MAP}"></iframe>`))).toBe(null)
    expect(paragraphIframe(paragraph('<iframe src="http://example.com"></iframe>'))).toBe(null)
  })
})

describe('iframe cards', () => {
  it('draws a card, hides the tag, and loads nothing before Show', () => {
    const { host } = mount([
      paragraph(`<iframe src="${MAP}" title="Rome" height="400"></iframe>`),
      paragraph('after'),
    ])
    const card = host.querySelector<HTMLElement>('.kore-link-card')!
    expect(card.querySelector('.kore-link-card-title')?.textContent).toBe('Rome')
    expect(card.querySelector('[data-link-card-layout]')).toBe(null)
    expect(host.querySelector('iframe')).toBe(null)
    expect(host.querySelector('p')?.classList.contains('kore-link-card-source')).toBe(true)

    const show = card.querySelector<HTMLElement>('.kore-link-card-poster [data-link-card-play]')!
    expect(show.getAttribute('aria-label')).toBe('Show openstreetmap.org')
    show.click()
    const frame = host.querySelector<HTMLIFrameElement>('.kore-link-card iframe')!
    expect(frame.src).toBe(MAP)
    expect(frame.getAttribute('sandbox')).toContain('allow-scripts')
    expect(frame.style.height).toBe('400px')
  })

  it('opens the framed page from the open button', () => {
    const { host } = mount([paragraph(`<iframe src="${MAP}"></iframe>`)])
    host
      .querySelector<HTMLElement>('[data-link-card-open]')!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    expect(opened).toEqual([MAP])
  })

  it('stops being a card once the line is no longer one iframe', () => {
    const { view, host } = mount([paragraph(`<iframe src="${MAP}"></iframe>`)])
    view.dispatch(view.state.tr.insertText('see ', 1))
    expect(host.querySelector('.kore-link-card')).toBe(null)
    expect(host.querySelector('p')?.className ?? '').toBe('')
  })
})
