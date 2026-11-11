import { Plugin, TextSelection, type Command } from '@prosekit/pm/state'
import { DecorationSet, type EditorView } from '@prosekit/pm/view'
import { buildDecorations, isLeaf } from './block-zoom-decorations'
import { deleteInZoom, enterOnRoot, selectAllInZoom, stepsStayInside } from './block-zoom-editing'
import {
  blockZoomKey,
  setZoom,
  withZoomMeta,
  zoomTarget,
  type BlockZoomState,
  type ZoomMeta,
} from './block-zoom-state'
import {
  crumbsFor,
  mapTarget,
  parentTarget,
  sameTarget,
  targetAt,
  targetSpan,
  type ZoomTarget,
} from './block-zoom-target'
import { animateZoom, ZOOM_PAGE_TRANSITION, ZOOMED_CLASS } from './block-zoom-transition'
import { lastFocusedEditor } from './focused-editor'

export type { ZoomTarget } from './block-zoom-target'
export { canZoom, clearZoom, zoomTarget } from './block-zoom-state'

/**
 * Zoom into a block (Plan 33, C1): the editor shows only that block, with a
 * breadcrumb back up. A list item brings its children, a heading brings its
 * section (down to the next heading of the same or a higher level), any other
 * top-level block (paragraph, quote, callout, code, table) shows alone.
 * Everything here is decorations and selection clamping, so the document, and
 * therefore the Markdown file, is never touched by zooming.
 *
 * This file holds the commands and the plugin; the state lives in
 * `block-zoom-state`, the animation in `block-zoom-transition`, what a zoom
 * draws in `block-zoom-decorations`, and editing inside one in
 * `block-zoom-editing`.
 */

/** Zoom into `target`, or back out to the whole note with null. */
export function zoomTo(view: EditorView, target: ZoomTarget | null): void {
  if (target !== null && targetSpan(view.state.doc, target) === null) {
    return
  }
  animateZoom(view, zoomTarget(view.state), target)
}

/** A breadcrumb click: edits inside the zoom move later sections, so read the crumb afresh. */
function jumpToCrumb(view: EditorView, index: number): void {
  const current = zoomTarget(view.state)
  const fresh = current === null ? undefined : crumbsFor(view.state.doc, current)[index]
  zoomTo(view, fresh === undefined ? null : fresh.target)
  view.focus()
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

/** Zoom into the block that starts at `pos` (a block handle's block). */
export function zoomIntoBlockAt(view: EditorView, pos: number): void {
  const doc = view.state.doc
  if (pos < 0 || pos >= doc.content.size) {
    return
  }
  const target = targetAt(doc, doc.resolve(pos + 1))
  if (target !== null && !sameTarget(target, zoomTarget(view.state))) {
    zoomTo(view, target)
  }
}

/**
 * Zoom the last focused editor in (around its caret) or out one level, and
 * give it focus back. Returns whether anything changed.
 */
export function zoomLastFocusedEditor(direction: 'in' | 'out'): boolean {
  const view = lastFocusedEditor()
  if (view === null) {
    return false
  }
  const ran = (direction === 'in' ? zoomIn : zoomOut)(view.state, view.dispatch, view)
  view.focus()
  return ran
}

/** The editor keymap the zoom installs (see `KORE_EDITOR_BINDINGS`). */
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
      apply: (tr, previous, oldState, newState) => {
        const meta = tr.getMeta(blockZoomKey) as ZoomMeta | undefined
        if (meta !== undefined) {
          return {
            target: meta.target,
            decorations: buildDecorations(newState.doc, meta.target, meta.transition, jumpToCrumb),
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
        // A leaf's hint comes and goes with its first child, so that rebuilds too.
        const sameShape =
          target === previous.target &&
          previous.transition === null &&
          (target === null ||
            isLeaf(oldState.doc, previous.target) === isLeaf(newState.doc, target))
        return sameShape
          ? { target, decorations: previous.decorations.map(tr.mapping, tr.doc), transition: null }
          : {
              target,
              decorations: buildDecorations(newState.doc, target, null, jumpToCrumb),
              transition: null,
            }
      },
    },
    filterTransaction: (tr, state) => {
      const target = zoomTarget(state)
      return target === null || !tr.docChanged || stepsStayInside(tr, target, state.doc)
    },
    appendTransaction: (transactions, _oldState, newState) => {
      const target = zoomTarget(newState)
      const span = target === null ? null : targetSpan(newState.doc, target)
      if (target === null || span === null) {
        return null
      }
      const inner = { from: span.from + 1, to: span.to - 1 }
      const { from, to, empty } = newState.selection
      if (from >= inner.from && to <= inner.to) {
        return null
      }
      // A range selected wholly outside the zoom was put there on purpose (a
      // Find match, a link to a line): zoom out until it shows instead of
      // pulling it back. Arrow keys at the edge only nudge a caret out, and
      // that is clamped below.
      const jumped =
        !empty &&
        (to <= inner.from || from >= inner.to) &&
        transactions.some((tr) => tr.selectionSet)
      if (jumped) {
        let wider = parentTarget(newState.doc, target)
        for (
          let widerSpan = wider === null ? null : targetSpan(newState.doc, wider);
          wider !== null && (widerSpan === null || from <= widerSpan.from || to >= widerSpan.to);
          widerSpan = wider === null ? null : targetSpan(newState.doc, wider)
        ) {
          wider = parentTarget(newState.doc, wider)
        }
        return withZoomMeta(newState.tr, wider, null).scrollIntoView()
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
