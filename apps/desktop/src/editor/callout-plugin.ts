import { calloutLabel, parseCalloutMarker, type CalloutMarker } from '@reflect/core'
import type { Node as ProseMirrorNode } from '@prosekit/pm/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@prosekit/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@prosekit/pm/view'

/** Plugin state: the decorations and what they were drawn from. */
interface CalloutState {
  readonly decorations: DecorationSet
  /** Blockquote positions toggled away from the fold their marker asks for. */
  readonly toggled: readonly number[]
  /** Whether the editor has focus; an unfocused caret reveals no marker. */
  readonly focused: boolean
}

/** Transaction meta: flip one callout's fold, or report a focus change. */
type CalloutMeta = { readonly toggle: number } | { readonly focused: boolean }

const calloutKey = new PluginKey<CalloutState>('reflect-callouts')

function readMeta(tr: Transaction): CalloutMeta | null {
  const meta: unknown = tr.getMeta(calloutKey)
  if (typeof meta !== 'object' || meta === null) {
    return null
  }
  if ('toggle' in meta && typeof meta.toggle === 'number') {
    return { toggle: meta.toggle }
  }
  if ('focused' in meta && typeof meta.focused === 'boolean') {
    return { focused: meta.focused }
  }
  return null
}

/** Where the first line of a paragraph ends, as a document position. */
function lineEnd(paragraph: ProseMirrorNode, contentStart: number): number {
  let end: number | null = null
  paragraph.forEach((child, offset) => {
    if (end !== null || !child.isText) {
      return
    }
    const breakAt = (child.text ?? '').indexOf('\n')
    if (breakAt !== -1) {
      end = contentStart + offset + breakAt
    }
  })
  return end ?? contentStart + paragraph.content.size
}

function labelWidget(marker: CalloutMarker): HTMLElement {
  const label = document.createElement('span')
  label.className = 'kore-callout-label'
  label.textContent = calloutLabel(marker)
  return label
}

function iconWidget(): HTMLElement {
  const icon = document.createElement('span')
  icon.className = 'kore-callout-icon'
  icon.setAttribute('aria-hidden', 'true')
  return icon
}

function foldButton(view: EditorView, quotePos: number, folded: boolean): HTMLElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'kore-callout-fold'
  button.contentEditable = 'false'
  button.setAttribute('aria-expanded', String(!folded))
  button.setAttribute('aria-label', folded ? 'Expand callout' : 'Collapse callout')
  // Keep the caret where it is: a fold is a view toggle, not an edit.
  button.addEventListener('mousedown', (event) => {
    event.preventDefault()
  })
  button.addEventListener('click', (event) => {
    event.preventDefault()
    view.dispatch(view.state.tr.setMeta(calloutKey, { toggle: quotePos }))
  })
  return button
}

function buildDecorations(
  state: EditorState,
  toggled: readonly number[],
  focused: boolean,
): DecorationSet {
  const { doc, selection } = state
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      return false
    }
    if (node.type.name !== 'blockquote') {
      return true
    }
    const paragraph = node.firstChild
    if (paragraph === null || paragraph.type.name !== 'paragraph') {
      return true
    }
    const marker = parseCalloutMarker(paragraph.textContent.split('\n', 1)[0] ?? '')
    if (marker === null) {
      return true
    }
    const titleStart = pos + 2
    const titleEnd = lineEnd(paragraph, titleStart)
    const bodyEnd = titleStart + paragraph.content.size
    const quoteEnd = pos + node.nodeSize
    const onTitle = focused && selection.from <= titleEnd && selection.to >= titleStart
    const inBody = focused && selection.to > titleEnd && selection.from < quoteEnd
    const flipped = toggled.includes(pos)
    const folded = marker.fold !== 'none' && (marker.fold === 'closed') !== flipped && !inBody

    const attrs: Record<string, string> = {
      'data-callout': marker.kind,
      'data-callout-fold': marker.fold,
    }
    if (folded) {
      attrs['data-callout-folded'] = ''
    }
    decorations.push(Decoration.node(pos, quoteEnd, attrs))
    decorations.push(
      Decoration.widget(titleStart, iconWidget, {
        side: -1,
        key: 'callout-icon',
      }),
    )
    if (titleEnd > titleStart) {
      decorations.push(
        Decoration.inline(titleStart, titleEnd, {
          class: 'kore-callout-title',
        }),
      )
    }
    if (!onTitle) {
      decorations.push(
        Decoration.inline(titleStart, titleStart + marker.markerLength, {
          class: 'kore-callout-marker',
        }),
      )
      if (marker.title === null) {
        decorations.push(
          Decoration.widget(titleEnd, () => labelWidget(marker), {
            side: -1,
            key: `callout-label:${marker.type}`,
          }),
        )
      }
    }
    if (marker.fold !== 'none') {
      decorations.push(
        Decoration.widget(titleEnd, (view) => foldButton(view, pos, folded), {
          side: 1,
          ignoreSelection: true,
          stopEvent: () => true,
          key: `callout-fold:${pos}:${folded}`,
        }),
      )
    }
    if (folded && bodyEnd > titleEnd) {
      decorations.push(Decoration.inline(titleEnd, bodyEnd, { class: 'kore-callout-hidden' }))
    }
    return true
  })
  return DecorationSet.create(doc, decorations)
}

function nextToggled(
  tr: Transaction,
  toggled: readonly number[],
  meta: CalloutMeta | null,
): readonly number[] {
  const mapped = toggled
    .map((pos) => tr.mapping.mapResult(pos, 1))
    .filter((result) => !result.deleted)
    .map((result) => result.pos)
  if (meta === null || !('toggle' in meta)) {
    return mapped
  }
  return mapped.includes(meta.toggle)
    ? mapped.filter((pos) => pos !== meta.toggle)
    : [...mapped, meta.toggle]
}

function setFocused(view: EditorView, focused: boolean): boolean {
  if (calloutKey.getState(view.state)?.focused !== focused) {
    view.dispatch(view.state.tr.setMeta(calloutKey, { focused }))
  }
  return false
}

/**
 * The ProseMirror plugin behind {@link CalloutHighlighter}: decorations
 * only, rebuilt when the document, the selection, focus or a fold changes.
 */
export function createCalloutPlugin(): Plugin<CalloutState> {
  return new Plugin<CalloutState>({
    key: calloutKey,
    state: {
      init: (_config, state) => ({
        decorations: buildDecorations(state, [], false),
        toggled: [],
        focused: false,
      }),
      apply: (tr, previous, _oldState, newState) => {
        const meta = readMeta(tr)
        if (!tr.docChanged && !tr.selectionSet && meta === null) {
          return previous
        }
        const toggled = nextToggled(tr, previous.toggled, meta)
        const focused = meta !== null && 'focused' in meta ? meta.focused : previous.focused
        return {
          decorations: buildDecorations(newState, toggled, focused),
          toggled,
          focused,
        }
      },
    },
    props: {
      decorations: (state) => calloutKey.getState(state)?.decorations ?? DecorationSet.empty,
      handleDOMEvents: {
        focus: (view) => setFocused(view, true),
        blur: (view) => setFocused(view, false),
      },
    },
  })
}
