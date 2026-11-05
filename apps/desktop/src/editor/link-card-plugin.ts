import type { LinkPreview } from '@reflect/core'
import type { Node as ProseMirrorNode } from '@prosekit/pm/model'
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Transaction,
} from '@prosekit/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@prosekit/pm/view'
import { linkCardElement } from './link-card-dom'

/**
 * Link preview cards in the live editor: a paragraph holding nothing but a
 * pasted URL draws as a card for that page (or post). The markdown keeps the
 * plain link — the card is a widget decoration in front of the paragraph,
 * and the paragraph itself is hidden until the caret is on it, the same
 * reveal-on-caret rule callouts use for their marker. A plain click on the
 * card puts the caret on the link (revealing it to edit or delete); a
 * mod-click opens it, the editor's one link-open gesture.
 */

export interface LinkCardOptions {
  /** Ask for a link's preview; answer later with {@link deliverLinkPreview}. */
  request: (url: string, view: EditorView) => void
  /** Open the link a card stands for (mod-click). */
  open: (url: string, event: MouseEvent) => void
}

interface LinkCardState {
  readonly decorations: DecorationSet
  /** Every preview delivered this editor session, by URL. */
  readonly previews: ReadonlyMap<string, LinkPreview>
  readonly focused: boolean
}

type LinkCardMeta = { readonly preview: LinkPreview } | { readonly focused: boolean }

const linkCardKey = new PluginKey<LinkCardState>('kore-link-cards')

const LINK_MARK = 'mdLinkText'
const BARE_URL = /^https?:\/\/\S+$/i

function readMeta(tr: Transaction): LinkCardMeta | null {
  const meta: unknown = tr.getMeta(linkCardKey)
  if (typeof meta !== 'object' || meta === null) {
    return null
  }
  if ('preview' in meta && typeof meta.preview === 'object' && meta.preview !== null) {
    return { preview: meta.preview as LinkPreview }
  }
  if ('focused' in meta && typeof meta.focused === 'boolean') {
    return { focused: meta.focused }
  }
  return null
}

/**
 * The URL a paragraph draws as a card, or `null` when it is not one. Only a
 * pasted link qualifies: the paragraph's whole text is one http(s) URL and
 * that text is the link's own href. A named link (`[YC](url)`) keeps its
 * sentence, and a link with words around it stays inline — a card replaces a
 * URL nobody wanted to read, never prose.
 */
export function paragraphCardUrl(paragraph: ProseMirrorNode): string | null {
  if (paragraph.type.name !== 'paragraph') {
    return null
  }
  const text = paragraph.textContent.trim()
  if (!BARE_URL.test(text)) {
    return null
  }
  let linked = true
  paragraph.forEach((child) => {
    if (!child.isText) {
      linked = false
      return
    }
    if ((child.text ?? '').trim() === '') {
      return
    }
    const mark = child.marks.find((candidate) => candidate.type.name === LINK_MARK)
    if (mark?.attrs.href !== text) {
      linked = false
    }
  })
  return linked ? text : null
}

/** Every card-shaped paragraph in the document, with where it sits. */
function cardParagraphs(
  doc: ProseMirrorNode,
): { url: string; pos: number; node: ProseMirrorNode }[] {
  const found: { url: string; pos: number; node: ProseMirrorNode }[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) {
      return true
    }
    const url = paragraphCardUrl(node)
    if (url !== null) {
      found.push({ url, pos, node })
    }
    return false
  })
  return found
}

function cardWidget(options: LinkCardOptions, preview: LinkPreview, paragraphPos: number) {
  return (view: EditorView): HTMLElement => {
    const card = linkCardElement(preview)
    card.addEventListener('mousedown', (event) => {
      if (event.button !== 0) {
        return
      }
      event.preventDefault()
      if (event.metaKey || event.ctrlKey) {
        options.open(preview.url, event)
        return
      }
      // The paragraph may have moved since this widget was drawn; resolve it
      // again from the current document rather than trusting the old offset.
      const paragraph = view.state.doc.nodeAt(paragraphPos)
      if (paragraph === null || paragraphCardUrl(paragraph) !== preview.url) {
        return
      }
      const end = paragraphPos + 1 + paragraph.content.size
      view.focus()
      view.dispatch(
        view.state.tr
          .setSelection(TextSelection.create(view.state.doc, end))
          .setMeta(linkCardKey, { focused: true }),
      )
    })
    return card
  }
}

function buildDecorations(
  state: EditorState,
  previews: ReadonlyMap<string, LinkPreview>,
  focused: boolean,
  options: LinkCardOptions,
): DecorationSet {
  const { doc, selection } = state
  const decorations: Decoration[] = []
  for (const { url, pos, node } of cardParagraphs(doc)) {
    const preview = previews.get(url)
    if (preview === undefined) {
      continue
    }
    const end = pos + node.nodeSize
    const onLine = focused && selection.from <= end - 1 && selection.to >= pos + 1
    decorations.push(
      Decoration.widget(pos, cardWidget(options, preview, pos), {
        side: -1,
        ignoreSelection: true,
        stopEvent: () => true,
        key: `link-card:${pos}:${url}`,
      }),
    )
    decorations.push(
      Decoration.node(pos, end, {
        class: onLine ? 'kore-link-card-source is-editing' : 'kore-link-card-source',
      }),
    )
  }
  return DecorationSet.create(doc, decorations)
}

function setFocused(view: EditorView, focused: boolean): boolean {
  if (linkCardKey.getState(view.state)?.focused !== focused) {
    view.dispatch(view.state.tr.setMeta(linkCardKey, { focused }))
  }
  return false
}

/** Hand the plugin a preview it asked for; the matching lines redraw. */
export function deliverLinkPreview(view: EditorView, preview: LinkPreview): void {
  if (view.isDestroyed) {
    return
  }
  if (linkCardKey.getState(view.state)?.previews.get(preview.url) === preview) {
    return
  }
  view.dispatch(view.state.tr.setMeta(linkCardKey, { preview }))
}

function requestMissing(view: EditorView, options: LinkCardOptions): void {
  const previews = linkCardKey.getState(view.state)?.previews
  for (const { url } of cardParagraphs(view.state.doc)) {
    if (previews?.has(url) !== true) {
      options.request(url, view)
    }
  }
}

/** The ProseMirror plugin behind `LinkPreviewCards`. */
export function createLinkCardPlugin(options: LinkCardOptions): Plugin<LinkCardState> {
  return new Plugin<LinkCardState>({
    key: linkCardKey,
    state: {
      init: () => ({ decorations: DecorationSet.empty, previews: new Map(), focused: false }),
      apply: (tr, previous, _oldState, newState) => {
        const meta = readMeta(tr)
        if (!tr.docChanged && !tr.selectionSet && meta === null) {
          return previous
        }
        let previews = previous.previews
        if (meta !== null && 'preview' in meta) {
          const next = new Map(previews)
          next.set(meta.preview.url, meta.preview)
          previews = next
        }
        const focused = meta !== null && 'focused' in meta ? meta.focused : previous.focused
        return {
          decorations: buildDecorations(newState, previews, focused, options),
          previews,
          focused,
        }
      },
    },
    view: (view) => {
      // Mounted into an editor that already has focus (the plugin arrives
      // once the note's privacy resolves): no focus event will tell us.
      if (view.hasFocus()) {
        queueMicrotask(() => {
          if (!view.isDestroyed) setFocused(view, view.hasFocus())
        })
      }
      requestMissing(view, options)
      return {
        update: (current, previousState) => {
          if (!current.state.doc.eq(previousState.doc)) {
            requestMissing(current, options)
          }
        },
      }
    },
    props: {
      decorations: (state) => linkCardKey.getState(state)?.decorations ?? DecorationSet.empty,
      handleDOMEvents: {
        focus: (view) => setFocused(view, true),
        blur: (view) => setFocused(view, false),
      },
    },
  })
}
