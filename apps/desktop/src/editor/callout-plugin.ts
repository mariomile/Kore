import { calloutLabel, parseCalloutMarker, type CalloutMarker } from '@kore/core'
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

const calloutKey = new PluginKey<CalloutState>('kore-callouts')

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

/** The blockquote holding the widget at `widgetPos`, as the position before it. */
function quoteAt(view: EditorView, widgetPos: number): number | null {
  const $pos = view.state.doc.resolve(widgetPos)
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.name === 'blockquote') {
      return $pos.before(depth)
    }
  }
  return null
}

function foldButton(
  view: EditorView,
  getPos: () => number | undefined,
  folded: boolean,
): HTMLElement {
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
    // Resolved at click time: the decoration is mapped across edits, so the
    // position it was drawn at may have moved.
    const widgetPos = getPos()
    const quotePos = widgetPos === undefined ? null : quoteAt(view, widgetPos)
    if (quotePos !== null) {
      view.dispatch(view.state.tr.setMeta(calloutKey, { toggle: quotePos }))
    }
  })
  return button
}

/** The callout decorations of every callout in `from`–`to`. */
function decorateRange(
  state: EditorState,
  from: number,
  to: number,
  toggled: readonly number[],
  focused: boolean,
): Decoration[] {
  const { doc, selection } = state
  const decorations: Decoration[] = []
  doc.nodesBetween(from, to, (node, pos) => {
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
        Decoration.widget(titleEnd, (view, getPos) => foldButton(view, getPos, folded), {
          side: 1,
          ignoreSelection: true,
          stopEvent: () => true,
          key: `callout-fold:${folded}`,
        }),
      )
    }
    if (folded && bodyEnd > titleEnd) {
      decorations.push(Decoration.inline(titleEnd, bodyEnd, { class: 'kore-callout-hidden' }))
    }
    return true
  })
  return decorations
}

function buildDecorations(
  state: EditorState,
  toggled: readonly number[],
  focused: boolean,
): DecorationSet {
  return DecorationSet.create(
    state.doc,
    decorateRange(state, 0, state.doc.content.size, toggled, focused),
  )
}

/**
 * The top-level blocks of `doc` that `from`–`to` touches, as one span. A
 * callout's decorations depend only on the blockquote itself, so redrawing
 * the top-level blocks around a change (which hold any nested quote) is the
 * same as redrawing the document.
 */
function topLevelSpan(doc: ProseMirrorNode, from: number, to: number): [number, number] | null {
  if (doc.childCount === 0) {
    return null
  }
  const clamp = (pos: number): number => Math.max(0, Math.min(pos, doc.content.size))
  const $from = doc.resolve(clamp(from))
  const $to = doc.resolve(clamp(to))
  const first = Math.min($from.index(0), doc.childCount - 1)
  const last = Math.min($to.index(0), doc.childCount - 1)
  return [$from.posAtIndex(first, 0), $to.posAtIndex(last + 1, 0)]
}

/**
 * Where in the new document this transaction can have changed a callout's
 * decorations: the edited ranges, plus the old and new selection (a caret on
 * a title reveals its marker, a caret in a body unfolds it).
 */
function touchedRanges(tr: Transaction, oldState: EditorState): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  for (const [index, map] of tr.mapping.maps.entries()) {
    const rest = tr.mapping.slice(index + 1)
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      ranges.push([rest.map(newStart, -1), rest.map(newEnd, 1)])
    })
  }
  const before = oldState.selection
  ranges.push([tr.mapping.map(before.from, -1), tr.mapping.map(before.to, 1)])
  ranges.push([tr.selection.from, tr.selection.to])
  return ranges
}

/**
 * Redraw only the top-level blocks the transaction touched, mapping the rest:
 * walking the whole document on every keystroke cost ~6 ms per key on a long
 * note in WebKit.
 */
function updateDecorations(
  tr: Transaction,
  oldState: EditorState,
  newState: EditorState,
  previous: DecorationSet,
  toggled: readonly number[],
  focused: boolean,
): DecorationSet {
  let decorations = previous.map(tr.mapping, tr.doc)
  const spans: Array<[number, number]> = []
  for (const [from, to] of touchedRanges(tr, oldState)) {
    const span = topLevelSpan(tr.doc, from, to)
    if (span !== null) {
      spans.push(span)
    }
  }
  spans.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const span of spans) {
    const last = merged.at(-1)
    if (last !== undefined && span[0] <= last[1]) {
      last[1] = Math.max(last[1], span[1])
    } else {
      merged.push([span[0], span[1]])
    }
  }
  for (const [start, end] of merged) {
    const stale = decorations
      .find(start, end)
      .filter((decoration) => decoration.from >= start && decoration.to <= end)
    decorations = decorations
      .remove(stale)
      .add(tr.doc, decorateRange(newState, start, end, toggled, focused))
  }
  return decorations
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
      apply: (tr, previous, oldState, newState) => {
        const meta = readMeta(tr)
        if (!tr.docChanged && !tr.selectionSet && meta === null) {
          return previous
        }
        const toggled = nextToggled(tr, previous.toggled, meta)
        const focused = meta !== null && 'focused' in meta ? meta.focused : previous.focused
        // A fold or focus change redraws every callout; an edit or a caret
        // move only the blocks it touched.
        const decorations =
          meta === null
            ? updateDecorations(tr, oldState, newState, previous.decorations, toggled, focused)
            : buildDecorations(newState, toggled, focused)
        return { decorations, toggled, focused }
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
