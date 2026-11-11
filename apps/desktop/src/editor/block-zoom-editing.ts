import type { Node as ProseMirrorNode } from '@prosekit/pm/model'
import {
  Selection,
  TextSelection,
  type Command,
  type EditorState,
  type Transaction,
} from '@prosekit/pm/state'
import { targetSpan, type ZoomTarget } from './block-zoom-target'
import { zoomTarget } from './block-zoom-state'

/**
 * Editing inside a zoom: the keys that would otherwise reach past its edge,
 * and the check that refuses any edit that does.
 */

/**
 * Enter on a zoomed list item's own line opens a first child (taking the text
 * after the caret along): the sibling it would otherwise create falls outside
 * the zoom, which {@link stepsStayInside} refuses.
 */
export const enterOnRoot: Command = (state, dispatch) => {
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
export const selectAllInZoom: Command = (state, dispatch) => {
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
export const deleteInZoom: Command = (state, dispatch) => {
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

/**
 * Whether every step of `tr` stays inside the zoom, so nothing is moved,
 * joined or inserted where the zoom would hide it (an outdent, a list exit,
 * a block moved past the edge, a backward join). A whole-document replace (a
 * reload from disk) is always let through; the zoom then ends by itself.
 */
export function stepsStayInside(
  tr: Transaction,
  target: ZoomTarget,
  doc: ProseMirrorNode,
): boolean {
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
