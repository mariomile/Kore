import type { Node as ProseMirrorNode } from '@prosekit/pm/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@prosekit/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@prosekit/pm/view'
import { pageCardTarget } from '@kore/core'

/**
 * Sub pages drawn as cards (Craft's page blocks): a paragraph holding only
 * `[[Title]]` shows as a card with a page glyph, the title and a two-line
 * preview, and a tap opens the page. The Markdown keeps the plain link; the
 * card is a widget in front of the paragraph, which hides unless the caret
 * is on it (the link-card rule), so the link stays editable.
 */

export interface PagePreview {
  readonly title: string
  /** Null while loading or when the page is missing. */
  readonly excerpt: string | null
  readonly missing: boolean
}

export interface PageCardOptions {
  /** Ask for a page's preview; answer with {@link deliverPagePreview}. */
  request: (target: string, view: EditorView) => void
  open: (target: string) => void
}

interface PageCardState {
  readonly decorations: DecorationSet
  readonly previews: ReadonlyMap<string, PagePreview>
}

const pageCardKey = new PluginKey<PageCardState>('kore-page-cards')

function cardLines(doc: ProseMirrorNode): { target: string; pos: number; node: ProseMirrorNode }[] {
  const found: { target: string; pos: number; node: ProseMirrorNode }[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    if (node.type.name === 'paragraph') {
      const target = pageCardTarget(node.textContent)
      if (target !== null) found.push({ target, pos, node })
    }
    return false
  })
  return found
}

function cardElement(
  target: string,
  preview: PagePreview | undefined,
  open: () => void,
): HTMLElement {
  const card = document.createElement('div')
  card.className = 'kore-page-card'
  card.contentEditable = 'false'
  card.setAttribute('role', 'link')
  card.setAttribute('aria-label', `Open ${preview?.title ?? target}`)
  if (preview?.missing === true) card.dataset.missing = ''
  const glyph = document.createElement('span')
  glyph.className = 'kore-page-card-glyph'
  glyph.setAttribute('aria-hidden', 'true')
  const body = document.createElement('span')
  body.className = 'kore-page-card-body'
  const title = document.createElement('span')
  title.className = 'kore-page-card-title'
  title.textContent = preview?.title ?? target
  const excerpt = document.createElement('span')
  excerpt.className = 'kore-page-card-excerpt'
  excerpt.textContent =
    preview?.missing === true ? 'Page not found' : (preview?.excerpt ?? '') || 'Empty page'
  body.append(title, excerpt)
  card.append(glyph, body)
  card.addEventListener('click', (event) => {
    event.preventDefault()
    open()
  })
  return card
}

function build(
  state: EditorState,
  previews: ReadonlyMap<string, PagePreview>,
  options: PageCardOptions,
): DecorationSet {
  const { doc, selection } = state
  const decorations: Decoration[] = []
  for (const { target, pos, node } of cardLines(doc)) {
    const end = pos + node.nodeSize
    const editing = selection.from <= end - 1 && selection.to >= pos + 1
    const preview = previews.get(target)
    decorations.push(
      Decoration.widget(pos, () => cardElement(target, preview, () => options.open(target)), {
        side: -1,
        ignoreSelection: true,
        stopEvent: (event) => event.type === 'click' || event.type === 'mousedown',
        key: `page-card:${target}:${preview?.excerpt ?? ''}:${String(preview?.missing ?? '')}`,
      }),
      Decoration.node(pos, end, {
        class: editing ? 'kore-page-card-source is-editing' : 'kore-page-card-source',
      }),
    )
  }
  return DecorationSet.create(doc, decorations)
}

/** Hand the plugin a preview it asked for; the card redraws. */
export function deliverPagePreview(view: EditorView, target: string, preview: PagePreview): void {
  if (view.isDestroyed) return
  view.dispatch(view.state.tr.setMeta(pageCardKey, { target, preview }))
}

function requestMissing(view: EditorView, options: PageCardOptions): void {
  const previews = pageCardKey.getState(view.state)?.previews
  for (const { target } of cardLines(view.state.doc)) {
    if (previews?.has(target) !== true) options.request(target, view)
  }
}

export function createPageCardPlugin(options: PageCardOptions): Plugin<PageCardState> {
  return new Plugin<PageCardState>({
    key: pageCardKey,
    state: {
      init: (_, state) => ({ decorations: build(state, new Map(), options), previews: new Map() }),
      apply(tr: Transaction, value, old, next) {
        const meta = tr.getMeta(pageCardKey) as { target: string; preview: PagePreview } | undefined
        let previews = value.previews
        if (meta !== undefined) {
          const copy = new Map(previews)
          copy.set(meta.target, meta.preview)
          previews = copy
        }
        if (!tr.docChanged && meta === undefined && old.selection.eq(next.selection)) return value
        return { decorations: build(next, previews, options), previews }
      },
    },
    props: {
      decorations: (state) => pageCardKey.getState(state)?.decorations ?? null,
    },
    view(view) {
      requestMissing(view, options)
      return {
        update(next, previous) {
          if (next.state.doc !== previous.doc) requestMissing(next, options)
        },
      }
    },
  })
}
