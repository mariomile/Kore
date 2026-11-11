import { PluginKey, Selection, type EditorState, type Transaction } from '@prosekit/pm/state'
import type { DecorationSet } from '@prosekit/pm/view'
import { targetSpan, type ZoomTarget } from './block-zoom-target'

/**
 * The block zoom's plugin state and the one meta that changes it (Plan 33,
 * C1). Every other block-zoom module reads and sets the zoom through here.
 */

export interface BlockZoomState {
  readonly target: ZoomTarget | null
  /** Built when the zoom changes, then mapped through each edit. */
  readonly decorations: DecorationSet
  /** While a zoom animates: the block that slides, by its position. */
  readonly transition: number | null
}

/** The transaction meta that sets the zoom; only this module writes it. */
export interface ZoomMeta {
  readonly target: ZoomTarget | null
  readonly transition: number | null
}

export function withZoomMeta(
  tr: Transaction,
  target: ZoomTarget | null,
  transition: number | null,
) {
  const meta: ZoomMeta = { target, transition }
  return tr.setMeta(blockZoomKey, meta)
}

export const blockZoomKey = new PluginKey<BlockZoomState>('kore-block-zoom')

/** What the editor is zoomed into, or null when it shows the whole note. */
export function zoomTarget(state: EditorState): ZoomTarget | null {
  return blockZoomKey.getState(state)?.target ?? null
}

export function setZoom(
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

/**
 * End any zoom in `tr` itself, without the animated switch: for a caller that
 * moves the selection outside the zoom in the same transaction (a followed
 * `[[Note#^id]]`), so the caret lands before the zoom could clamp it.
 */
export function clearZoom(tr: Transaction): Transaction {
  return withZoomMeta(tr, null, null)
}

/** Whether this editor has the zoom installed (a block menu offers it then). */
export function canZoom(state: EditorState): boolean {
  return blockZoomKey.getState(state) !== undefined
}
