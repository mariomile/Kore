import { afterEach, describe, expect, it } from 'vitest'
import { Schema } from '@prosekit/pm/model'
import { EditorState, TextSelection } from '@prosekit/pm/state'
import { EditorView } from '@prosekit/pm/view'
import { claimPlayback } from './playback'
import { createVaultMediaPlugin, paragraphMedia } from './vault-media-plugin'

/**
 * Vault video and audio over a real ProseMirror view. The schema mirrors
 * meowdown's: a file embed is an `mdFile` mark on the embed's own text.
 */

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*', toDOM: () => ['p', 0] },
    text: {},
  },
  marks: {
    mdFile: {
      attrs: { href: { default: '' }, name: { default: '' }, title: { default: '' } },
      toDOM: () => ['span', { class: 'md-file' }, 0],
    },
  },
})

function fileParagraph(href: string, text = `![[${href}]]`) {
  return schema.nodes.paragraph!.create(
    null,
    schema.text(text, [schema.marks.mdFile!.create({ href, name: href })]),
  )
}

function plainParagraph(text: string) {
  return schema.nodes.paragraph!.create(null, schema.text(text))
}

function resolveUrl(href: string): string | null {
  return href.includes('missing') ? null : `kore-asset://localhost/1/assets/${href}`
}

let view: EditorView | null = null

function mount(blocks: ReturnType<typeof plainParagraph>[]) {
  const host = document.createElement('div')
  host.className = 'kore-editor'
  document.body.append(host)
  view = new EditorView(host, {
    state: EditorState.create({
      doc: schema.nodes.doc!.create(null, blocks),
      plugins: [createVaultMediaPlugin({ resolveUrl })],
    }),
  })
  return { view, host }
}

afterEach(() => {
  view?.dom.parentElement?.remove()
  view?.destroy()
  view = null
})

describe('paragraphMedia', () => {
  it('takes only a paragraph that is one embedded video or audio file', () => {
    expect(paragraphMedia(fileParagraph('demo.mp4'))?.kind).toBe('video')
    expect(paragraphMedia(fileParagraph('memo.m4a'))?.kind).toBe('audio')
    expect(paragraphMedia(fileParagraph('report.pdf'))).toBe(null)
    expect(paragraphMedia(fileParagraph('movie.mkv'))).toBe(null)
    expect(paragraphMedia(plainParagraph('demo.mp4'))).toBe(null)
  })
})

describe('vault media', () => {
  it('draws a video player that only reads the file metadata until played', () => {
    const { host } = mount([fileParagraph('demo.mp4'), plainParagraph('after')])
    const video = host.querySelector<HTMLVideoElement>('video.kore-vault-media-player')
    expect(video?.getAttribute('src')).toBe('kore-asset://localhost/1/assets/demo.mp4')
    expect(video?.preload).toBe('metadata')
    expect(video?.controls).toBe(true)
    expect(video?.autoplay).toBe(false)
    const source = host.querySelector('p')
    expect(source?.classList.contains('kore-vault-media-source')).toBe(true)
    expect(source?.classList.contains('is-editing')).toBe(false)
  })

  it('draws audio with its name', () => {
    const { host } = mount([fileParagraph('memo.m4a')])
    const box = host.querySelector<HTMLElement>('.kore-vault-media')
    expect(box?.dataset.kind).toBe('audio')
    expect(box?.querySelector('.kore-vault-media-name')?.textContent).toBe('memo.m4a')
    expect(box?.querySelector('audio')).not.toBe(null)
  })

  it('leaves a file it cannot resolve as its pill', () => {
    const { host } = mount([fileParagraph('missing.mp4')])
    expect(host.querySelector('.kore-vault-media')).toBe(null)
    expect(host.querySelector('p')?.className ?? '').toBe('')
  })

  it('shows the embed under the player while the caret is on it', () => {
    const { view, host } = mount([plainParagraph('before'), fileParagraph('demo.mp4')])
    view.focus()
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, view.state.doc.content.size - 2),
      ),
    )
    const source = host.querySelectorAll('p')[1]
    expect(source?.classList.contains('is-editing')).toBe(true)
  })

  it('keeps a playing video through an edit above it', () => {
    const { view, host } = mount([plainParagraph('before'), fileParagraph('demo.mp4')])
    const video = host.querySelector('video')
    view.dispatch(view.state.tr.insertText('more ', 1))
    expect(host.querySelector('video')).toBe(video)
  })

  it('pauses when something else starts playing', () => {
    const { host } = mount([fileParagraph('memo.m4a')])
    const audio = host.querySelector('audio')!
    let paused = 0
    audio.pause = () => {
      paused += 1
    }
    audio.dispatchEvent(new Event('play'))
    claimPlayback(() => {})
    expect(paused).toBe(1)
  })
})
