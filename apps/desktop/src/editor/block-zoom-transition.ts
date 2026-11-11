import type { Node as ProseMirrorNode } from '@prosekit/pm/model'
import type { EditorView } from '@prosekit/pm/view'
import { targetSpan, type ZoomTarget } from './block-zoom-target'
import { blockZoomKey, setZoom, withZoomMeta, zoomTarget } from './block-zoom-state'

/** The View Transition name for the page around the block that slides. */
export const ZOOM_PAGE_TRANSITION = 'view-transition-name: kore-zoom-page'
const ZOOM_TRANSITION_CLASS = 'kore-zoom-transition'
/** On the editor root while zoomed, so the note's chrome (properties) can step aside. */
export const ZOOMED_CLASS = 'kore-zoomed'

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
export function animateZoom(
  view: EditorView,
  from: ZoomTarget | null,
  to: ZoomTarget | null,
): void {
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
