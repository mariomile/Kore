import type { Node as ProseMirrorNode } from '@prosekit/pm/model'
import {
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
  type Command,
  type EditorState,
  type Transaction,
} from '@prosekit/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@prosekit/pm/view'
import {
  crumbsFor,
  mapTarget,
  parentTarget,
  sameTarget,
  targetAt,
  targetSpan,
  type ZoomTarget,
} from './block-zoom-target'

export type { ZoomTarget } from './block-zoom-target'

/**
 * Zoom into a block (Plan 33, C1): the editor shows only that block, with a
 * breadcrumb back up. A list item brings its children, a heading brings its
 * section (down to the next heading of the same or a higher level), any other
 * top-level block (paragraph, quote, callout, code, table) shows alone.
 * Everything here is decorations and selection clamping, so the document, and
 * therefore the Markdown file, is never touched by zooming.
 */

interface BlockZoomState {
  readonly target: ZoomTarget | null
  /** Built when the zoom changes, then mapped through each edit. */
  readonly decorations: DecorationSet
  /** While a zoom animates: the block that slides, by its position. */
  readonly transition: number | null
}

/** The transaction meta that sets the zoom; only this module writes it. */
interface ZoomMeta {
  readonly target: ZoomTarget | null
  readonly transition: number | null
}

function withZoomMeta(tr: Transaction, target: ZoomTarget | null, transition: number | null) {
  const meta: ZoomMeta = { target, transition }
  return tr.setMeta(blockZoomKey, meta)
}

const blockZoomKey = new PluginKey<BlockZoomState>('kore-block-zoom')

/** What the editor is zoomed into, or null when it shows the whole note. */
export function zoomTarget(state: EditorState): ZoomTarget | null {
  return blockZoomKey.getState(state)?.target ?? null
}

function setZoom(
  tr: Transaction,
  target: ZoomTarget | null,
  transition: number | null = null,
): Transaction {
  withZoomMeta(tr, target, transition)
  const span = target === null ? null : targetSpan(tr.doc, target)
  if (span !== null) {
    const { from, to } = tr.selection
    if (from <= span.from || to >= span.to) {
      tr.setSelection(Selection.near(tr.doc.resolve(span.from + 1)))
    }
  }
  return tr.scrollIntoView()
}

/** Zoom into `target`, or back out to the whole note with null. */
export function zoomTo(view: EditorView, target: ZoomTarget | null): void {
  if (target !== null && targetSpan(view.state.doc, target) === null) {
    return
  }
  animateZoom(view, zoomTarget(view.state), target)
}

/** Zoom into the block around the caret. */
export const zoomIn: Command = (state, dispatch, view) => {
  const target = targetAt(state.doc, state.selection.$from)
  if (target === null || sameTarget(target, zoomTarget(state))) {
    return false
  }
  if (view !== undefined) {
    animateZoom(view, zoomTarget(state), target)
  } else {
    dispatch?.(setZoom(state.tr, target))
  }
  return true
}

/** Zoom out one level: parent item, enclosing section, then the whole note. */
export const zoomOut: Command = (state, dispatch, view) => {
  const target = zoomTarget(state)
  if (target === null) {
    return false
  }
  const parent = parentTarget(state.doc, target)
  if (view !== undefined) {
    animateZoom(view, target, parent)
  } else {
    dispatch?.(setZoom(state.tr, parent))
  }
  return true
}

/** View Transition names for the zoom: the block that stays, and the page around it. */
const ZOOM_BLOCK_TRANSITION = 'view-transition-name: kore-zoom-block'
const ZOOM_PAGE_TRANSITION = 'view-transition-name: kore-zoom-page'
const ZOOM_TRANSITION_CLASS = 'kore-zoom-transition'
/** On the editor root while zoomed, so the note's chrome (properties) can step aside. */
const ZOOMED_CLASS = 'kore-zoomed'

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/** Each view's latest zoom animation, so an older one never clears a newer one. */
const zoomAnimations = new WeakMap<EditorView, number>()

/**
 * Change the zoom with a short View Transition: the block shared by both
 * zooms (the inner one's first block) slides between its place in the note
 * and the top, while the rest of the page crossfades. Instant when the
 * browser has no View Transitions or the user asks for reduced motion. The
 * transition names go on through decorations, since ProseMirror redraws a
 * block whose DOM is touched from outside.
 */
function animateZoom(view: EditorView, from: ZoomTarget | null, to: ZoomTarget | null): void {
  const apply = (transition: number | null): void => {
    if (!view.isDestroyed && (to === null || targetSpan(view.state.doc, to) !== null)) {
      view.dispatch(setZoom(view.state.tr, to, transition))
    }
  }
  const inner = to === null || (from !== null && isInside(view.state.doc, from, to)) ? from : to
  const span = inner === null ? null : targetSpan(view.state.doc, inner)
  if (
    span === null ||
    typeof document.startViewTransition !== 'function' ||
    prefersReducedMotion()
  ) {
    apply(null)
    return
  }
  const block = span.from
  const run = (zoomAnimations.get(view) ?? 0) + 1
  zoomAnimations.set(view, run)
  const root = document.documentElement
  root.classList.add(ZOOM_TRANSITION_CLASS)
  view.dispatch(withZoomMeta(view.state.tr, zoomTarget(view.state), block))
  const transition = document.startViewTransition(() => {
    apply(block)
  })
  const cleanup = (): void => {
    if (zoomAnimations.get(view) !== run) {
      return
    }
    root.classList.remove(ZOOM_TRANSITION_CLASS)
    if (!view.isDestroyed && blockZoomKey.getState(view.state)?.transition !== null) {
      view.dispatch(withZoomMeta(view.state.tr, zoomTarget(view.state), null))
    }
  }
  void transition.finished.then(cleanup, cleanup)
}

/** Whether zoom `inner` sits inside zoom `outer`. */
function isInside(doc: ProseMirrorNode, inner: ZoomTarget, outer: ZoomTarget): boolean {
  const innerSpan = targetSpan(doc, inner)
  const outerSpan = targetSpan(doc, outer)
  return (
    innerSpan !== null &&
    outerSpan !== null &&
    innerSpan.from >= outerSpan.from &&
    innerSpan.to <= outerSpan.to
  )
}

/**
 * Enter on a zoomed list item's own line opens a first child (taking the text
 * after the caret along): the sibling it would otherwise create falls outside
 * the zoom, which {@link stepsStayInside} refuses.
 */
const enterOnRoot: Command = (state, dispatch) => {
  const target = zoomTarget(state)
  if (target?.kind !== 'list') {
    return false
  }
  const item = state.doc.nodeAt(target.root)
  const line = item?.firstChild
  const lineStart = target.root + 2
  const lineEnd = lineStart + (line?.content.size ?? 0)
  const { from, to } = state.selection
  if (line?.isTextblock !== true || from < lineStart || to > lineEnd) {
    return false
  }
  const paragraph = state.schema.nodes['paragraph']
  const list = state.schema.nodes['list']
  if (paragraph === undefined || list === undefined) {
    return false
  }
  if (dispatch) {
    const tail = state.doc.slice(to, lineEnd).content
    const tr = state.tr.delete(from, lineEnd)
    const insertAt = tr.mapping.map(lineEnd) + 1
    tr.insert(
      insertAt,
      list.create({ kind: 'bullet', collapsed: false }, paragraph.create(null, tail)),
    )
    dispatch(tr.setSelection(TextSelection.create(tr.doc, insertAt + 2)).scrollIntoView())
  }
  return true
}

/**
 * Select-all selects the zoomed text only, from the first line to the last,
 * so a delete clears the branch and keeps its item (instead of being refused
 * for reaching past the zoom).
 */
const selectAllInZoom: Command = (state, dispatch) => {
  const target = zoomTarget(state)
  const span = target === null ? null : targetSpan(state.doc, target)
  if (span === null) {
    return false
  }
  const start = Selection.findFrom(state.doc.resolve(span.from + 1), 1, true)
  const end = Selection.findFrom(state.doc.resolve(span.to - 1), -1, true)
  if (start === null || end === null || end.to < start.from) {
    return false
  }
  dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, start.from, end.to)))
  return true
}

/**
 * Deleting a selection that spans blocks of the zoom deletes just that text.
 * The default delete widens to whole nodes (a fully selected branch drops its
 * own item), which the zoom would refuse.
 */
const deleteInZoom: Command = (state, dispatch) => {
  const { selection } = state
  if (selection.empty || selection.$from.sameParent(selection.$to)) {
    return false
  }
  const target = zoomTarget(state)
  if (target === null) {
    return false
  }
  let tr = state.tr.delete(selection.from, selection.to)
  if (!stepsStayInside(tr, target, state.doc)) {
    // A fully selected branch: keep its item, emptied.
    if (target.kind !== 'list') {
      return false
    }
    const item = state.doc.nodeAt(target.root)
    const paragraph = state.schema.nodes['paragraph']
    if (item === null || paragraph === undefined || !coversBranch(state, target.root, item)) {
      return false
    }
    tr = state.tr.replaceWith(target.root + 1, target.root + item.nodeSize - 1, paragraph.create())
    tr.setSelection(TextSelection.create(tr.doc, target.root + 2))
  }
  dispatch?.(tr.scrollIntoView())
  return true
}

/** Whether the selection runs from the item's first text to its branch's last. */
function coversBranch(state: EditorState, root: number, item: ProseMirrorNode): boolean {
  const start = Selection.findFrom(state.doc.resolve(root + 1), 1, true)
  const end = Selection.findFrom(state.doc.resolve(root + item.nodeSize - 1), -1, true)
  return (
    start !== null &&
    end !== null &&
    state.selection.from <= start.from &&
    state.selection.to >= end.to
  )
}

/** The editor keymap the zoom installs (see `REFLECT_EDITOR_BINDINGS`). */
export const ZOOM_IN_BINDING = 'Mod-Shift-.'
export const ZOOM_OUT_BINDING = 'Mod-Shift-,'

/**
 * Escape steps out of a zoom when there is nothing else for it to do: an
 * open menu claims it first (higher priority), and a selection is left for
 * Meowdown to collapse (this falls through when the selection is not empty).
 */
const escapeZoom: Command = (state, dispatch, view) =>
  state.selection.empty && zoomOut(state, dispatch, view)

export const blockZoomKeymap: Readonly<Record<string, Command>> = {
  [ZOOM_IN_BINDING]: zoomIn,
  [ZOOM_OUT_BINDING]: zoomOut,
  Escape: escapeZoom,
  Enter: enterOnRoot,
  'Mod-a': selectAllInZoom,
  Backspace: deleteInZoom,
  Delete: deleteInZoom,
}

/**
 * Whether every step of `tr` stays inside the zoom, so nothing is moved,
 * joined or inserted where the zoom would hide it (an outdent, a list exit,
 * a block moved past the edge, a backward join). A whole-document replace (a
 * reload from disk) is always let through; the zoom then ends by itself.
 */
function stepsStayInside(tr: Transaction, target: ZoomTarget, doc: ProseMirrorNode): boolean {
  const span = targetSpan(doc, target)
  if (span === null) {
    return true
  }
  let from = span.from
  let to = span.to
  // A range zoom accepts content added right at its end (a block inserted
  // after its last one); a list item's end is its own closing token.
  const lastInside = target.kind === 'range' ? (): number => to : (): number => to - 1
  for (const [index, step] of tr.steps.entries()) {
    const size = tr.docs[index]?.content.size ?? 0
    let inside = true
    let wholeDocument = false
    step.getMap().forEach((oldStart, oldEnd) => {
      if (oldStart === 0 && oldEnd === size) {
        wholeDocument = true
      }
      if (oldStart < from + 1 || oldEnd > lastInside()) {
        inside = false
      }
    })
    if (wholeDocument) {
      return true
    }
    if (!inside) {
      return false
    }
    from = step.getMap().map(from, 1)
    to = step.getMap().map(to, target.kind === 'range' ? 1 : -1)
  }
  return true
}

function breadcrumb(view: EditorView, target: ZoomTarget): HTMLElement {
  const nav = document.createElement('nav')
  nav.className = 'kore-zoom-breadcrumb'
  nav.contentEditable = 'false'
  nav.setAttribute('aria-label', 'Zoomed block')
  for (const [index, crumb] of crumbsFor(view.state.doc, target).entries()) {
    if (index > 0) {
      const separator = document.createElement('span')
      separator.className = 'kore-zoom-separator'
      separator.setAttribute('aria-hidden', 'true')
      separator.textContent = '›'
      nav.append(separator)
    }
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'kore-zoom-crumb'
    button.textContent = crumb.label
    button.title = crumb.label
    button.addEventListener('mousedown', (event) => {
      event.preventDefault()
    })
    button.addEventListener('click', (event) => {
      event.preventDefault()
      // Edits inside the zoom move later sections, so read the crumb afresh.
      const current = zoomTarget(view.state)
      const fresh = current === null ? undefined : crumbsFor(view.state.doc, current)[index]
      zoomTo(view, fresh === undefined ? null : fresh.target)
      view.focus()
    })
    nav.append(button)
  }
  return nav
}

function hide(from: number, node: ProseMirrorNode): Decoration {
  return Decoration.node(from, from + node.nodeSize, { class: 'kore-zoom-hidden' })
}

function listDecorations(doc: ProseMirrorNode, root: number, item: ProseMirrorNode): Decoration[] {
  const decorations: Decoration[] = []
  const $root = doc.resolve(root)
  for (let depth = 0; depth <= $root.depth; depth += 1) {
    const parent = $root.node(depth)
    const keep = $root.index(depth)
    const contentStart = depth === 0 ? 0 : $root.start(depth)
    parent.forEach((child, offset, index) => {
      if (index !== keep) {
        decorations.push(hide(contentStart + offset, child))
      }
    })
    if (depth > 0) {
      const from = $root.before(depth)
      decorations.push(
        Decoration.node(from, from + parent.nodeSize, { class: 'kore-zoom-ancestor' }),
      )
    }
  }
  decorations.push(
    Decoration.node(root, root + item.nodeSize, { class: 'kore-zoom-root', 'data-zoom-root': '' }),
  )
  return decorations
}

function rangeDecorations(doc: ProseMirrorNode, from: number, to: number): Decoration[] {
  const decorations: Decoration[] = []
  doc.forEach((child, offset) => {
    if (offset + child.nodeSize <= from || offset >= to) {
      decorations.push(hide(offset, child))
    }
  })
  return decorations
}

/**
 * The block that reads as the zoomed page's title: a list item's own line,
 * or the heading a section zoom starts with. A lone paragraph has none.
 */
function titleDecoration(doc: ProseMirrorNode, target: ZoomTarget): Decoration | null {
  const pos = target.kind === 'list' ? target.root + 1 : target.from
  const node = doc.nodeAt(pos)
  if (node === null || !node.isTextblock) {
    return null
  }
  if (target.kind === 'range' && node.type.name !== 'heading') {
    return null
  }
  return Decoration.node(pos, pos + node.nodeSize, { class: 'kore-zoom-title' })
}

function buildDecorations(
  doc: ProseMirrorNode,
  target: ZoomTarget | null,
  transition: number | null,
): DecorationSet {
  const sliding = transition === null ? null : doc.nodeAt(transition)
  const slide =
    transition === null || sliding === null
      ? []
      : [
          Decoration.node(transition, transition + sliding.nodeSize, {
            style: ZOOM_BLOCK_TRANSITION,
          }),
        ]
  const span = target === null ? null : targetSpan(doc, target)
  if (target === null || span === null) {
    return slide.length === 0 ? DecorationSet.empty : DecorationSet.create(doc, slide)
  }
  const decorations =
    target.kind === 'list'
      ? listDecorations(doc, target.root, doc.nodeAt(target.root) ?? doc)
      : rangeDecorations(doc, span.from, span.to)
  const title = titleDecoration(doc, target)
  if (title !== null) {
    decorations.push(title)
  }
  decorations.push(
    Decoration.widget(span.from, (view) => breadcrumb(view, target), {
      side: -1,
      ignoreSelection: true,
      stopEvent: () => true,
      key: 'zoom-breadcrumb',
    }),
  )
  return DecorationSet.create(doc, [...decorations, ...slide])
}

/** Marks the editor host while the pointer is over the zoomed item itself. */
const OVER_ROOT_ATTRIBUTE = 'data-zoom-over-root'

function setPointerOverRoot(view: EditorView, over: boolean): void {
  const host = view.dom.parentElement
  if (host !== null && host.hasAttribute(OVER_ROOT_ATTRIBUTE) !== over) {
    host.toggleAttribute(OVER_ROOT_ATTRIBUTE, over)
  }
}

/**
 * The block handle can't do anything with the zoomed item (moving it out of
 * the zoom is refused, deleting it would end the zoom), so it hides while
 * the pointer is on the item's own line. Its children keep their handles.
 */
function markPointerOverRoot(view: EditorView, event: MouseEvent): boolean {
  const target = zoomTarget(view.state)
  if (target?.kind !== 'list' || !(event.target instanceof Element)) {
    setPointerOverRoot(view, false)
    return false
  }
  const item = event.target.closest('.prosemirror-flat-list')
  setPointerOverRoot(view, item !== null && item === view.nodeDOM(target.root))
  return false
}

/** The list item a marker element belongs to, as the position before it. */
function markerListPos(view: EditorView, marker: Element): number | null {
  const listElement = marker.parentElement
  if (listElement === null) {
    return null
  }
  let inside: number
  try {
    inside = view.posAtDOM(listElement, 0)
  } catch {
    return null
  }
  const $inside = view.state.doc.resolve(inside)
  for (let depth = $inside.depth; depth > 0; depth -= 1) {
    const before = $inside.before(depth)
    if (view.nodeDOM(before) === listElement) {
      return before
    }
  }
  return null
}

/** ⌘-click (Ctrl-click off macOS) on a bullet zooms into it; a plain click keeps folding. */
function handleMarkerMouseDown(view: EditorView, event: MouseEvent): boolean {
  if (!(event.metaKey || event.ctrlKey) || event.button !== 0) {
    return false
  }
  const target = event.target
  if (!(target instanceof Element)) {
    return false
  }
  const marker = target.closest('.list-marker')
  if (marker === null || !view.dom.contains(marker)) {
    return false
  }
  const root = markerListPos(view, marker)
  if (root === null) {
    return false
  }
  event.preventDefault()
  zoomTo(view, { kind: 'list', root })
  view.focus()
  return true
}

/**
 * The ProseMirror plugin behind {@link BlockZoom}. The zoom maps through every
 * edit and ends by itself when its block is deleted or the document is
 * replaced (a reload or a note switch).
 */
export interface BlockZoomOptions {
  /** Called when the zoom starts, moves or ends (null), and on teardown. */
  readonly onZoomChange?: (view: EditorView, target: ZoomTarget | null) => void
}

export function createBlockZoomPlugin(options: BlockZoomOptions = {}): Plugin<BlockZoomState> {
  return new Plugin<BlockZoomState>({
    key: blockZoomKey,
    view: (editorView) => ({
      update: (view, previous) => {
        const target = zoomTarget(view.state)
        if (!sameTarget(target, zoomTarget(previous))) {
          setPointerOverRoot(view, false)
          options.onZoomChange?.(view, target)
        }
      },
      destroy: () => {
        options.onZoomChange?.(editorView, null)
      },
    }),
    state: {
      init: () => ({ target: null, decorations: DecorationSet.empty, transition: null }),
      apply: (tr, previous, _oldState, newState) => {
        const meta = tr.getMeta(blockZoomKey) as ZoomMeta | undefined
        if (meta !== undefined) {
          return {
            target: meta.target,
            decorations: buildDecorations(newState.doc, meta.target, meta.transition),
            transition: meta.transition,
          }
        }
        if (!tr.docChanged || (previous.target === null && previous.transition === null)) {
          return previous
        }
        if (previous.target === null) {
          return { target: null, decorations: DecorationSet.empty, transition: null }
        }
        const target = mapTarget(tr.mapping, previous.target, newState.doc)
        // Edits inside the zoom only shift what it hides, so the decorations
        // map; the zoom moving or ending rebuilds them.
        return target === previous.target && previous.transition === null
          ? { target, decorations: previous.decorations.map(tr.mapping, tr.doc), transition: null }
          : { target, decorations: buildDecorations(newState.doc, target, null), transition: null }
      },
    },
    filterTransaction: (tr, state) => {
      const target = zoomTarget(state)
      return target === null || !tr.docChanged || stepsStayInside(tr, target, state.doc)
    },
    appendTransaction: (_transactions, _oldState, newState) => {
      const target = zoomTarget(newState)
      const span = target === null ? null : targetSpan(newState.doc, target)
      if (span === null) {
        return null
      }
      const inner = { from: span.from + 1, to: span.to - 1 }
      const { from, to } = newState.selection
      if (from >= inner.from && to <= inner.to) {
        return null
      }
      const clamp = (pos: number): number => Math.min(Math.max(pos, inner.from), inner.to)
      return newState.tr.setSelection(
        TextSelection.between(newState.doc.resolve(clamp(from)), newState.doc.resolve(clamp(to))),
      )
    },
    props: {
      decorations: (state) => blockZoomKey.getState(state)?.decorations ?? DecorationSet.empty,
      attributes: (state): Record<string, string> => {
        const zoom = blockZoomKey.getState(state)
        return {
          ...(zoom?.target == null ? {} : { class: ZOOMED_CLASS }),
          ...(zoom?.transition == null ? {} : { style: ZOOM_PAGE_TRANSITION }),
        }
      },
      handleDOMEvents: {
        mousedown: handleMarkerMouseDown,
        mousemove: markPointerOverRoot,
        mouseleave: (view) => {
          setPointerOverRoot(view, false)
          return false
        },
      },
    },
  })
}
