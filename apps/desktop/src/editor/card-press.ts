import type { Node as ProseMirrorNode } from '@prosekit/pm/model'
import { TextSelection } from '@prosekit/pm/state'
import type { EditorView } from '@prosekit/pm/view'

interface CardPressOptions {
  /** The page the card stands for, opened by its open button or a mod-click. */
  readonly url: string
  readonly open: (url: string, event: MouseEvent) => void
  /** Whether a paragraph is still the one this card draws. */
  readonly drawn: (paragraph: ProseMirrorNode) => boolean
}

/** Buttons that act on click (link-card-dom), and a playing card's player. */
const OWN_CONTROLS =
  '[data-link-card-layout], [data-link-card-play], [data-link-card-close], .kore-link-card-player'

/**
 * How a press on a card widget in front of its paragraph behaves: its own
 * controls act on click and the press only keeps the caret; the open button
 * or a mod-click opens the page; any other press puts the caret at the end
 * of the paragraph, revealing the markdown to edit or delete.
 */
export function handleCardPress(
  card: HTMLElement,
  view: EditorView,
  { url, open, drawn }: CardPressOptions,
): void {
  card.addEventListener('mousedown', (event) => {
    if (event.button !== 0) {
      return
    }
    event.preventDefault()
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest(OWN_CONTROLS)) {
      return
    }
    if (target?.closest('[data-link-card-open]') || event.metaKey || event.ctrlKey) {
      open(url, event)
      return
    }
    // The widget is kept across edits above it, so where its paragraph sits
    // now is read from the DOM, not from when it was drawn.
    let paragraphPos: number
    try {
      paragraphPos = view.posAtDOM(card, 0)
    } catch {
      return
    }
    const paragraph = view.state.doc.nodeAt(paragraphPos)
    if (paragraph === null || !drawn(paragraph)) {
      return
    }
    view.focus()
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, paragraphPos + 1 + paragraph.content.size),
      ),
    )
  })
}
