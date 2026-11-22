import type { Node as ProseMirrorNode } from '@prosekit/pm/model'
import { isListNode, type BlockRange } from './block-selection-plugin'

/**
 * Where a dragged block may land, worked out once when the drag starts so the
 * finger's every move is a lookup with no layout read.
 *
 * The note is cut into rows, one per block that is not being dragged: a
 * top-level block is one row, and a list item is the row of its own line with
 * its nested items as rows of their own. The upper half of a row drops above
 * its block; the lower half drops below it, at the row's own level. Under the
 * last item of a nested list "below" is ambiguous (still nested, or out at
 * one of the levels above), so that row offers every level and the finger's
 * horizontal position picks: slide left to step out.
 */

/** A block's box, in whatever vertical coordinates the caller hit-tests in. */
export interface BlockBox {
  top: number
  bottom: number
  left: number
}

/** One gap between blocks: the document position, and the level's left edge. */
interface Gap {
  pos: number
  left: number
}

export interface DropRow {
  top: number
  bottom: number
  before: Gap
  /** Deepest level first. */
  after: readonly Gap[]
}

/** The gap under the finger, and where its marker draws. */
export interface DropSlot {
  pos: number
  y: number
  left: number
}

/**
 * The rows of `doc`, top to bottom, skipping the dragged blocks. `boxOf`
 * measures the block starting at a position (null when it is not on screen
 * as an element). List items nest only when `nest` is on: a paragraph or a
 * heading lands between top-level blocks, never inside a list item.
 */
export function buildDropRows(
  doc: ProseMirrorNode,
  dragged: readonly BlockRange[],
  boxOf: (pos: number) => BlockBox | null,
  nest: boolean,
): DropRow[] {
  const skip = new Set(dragged.map((block) => block.from))
  const rows: DropRow[] = []

  const visit = (node: ProseMirrorNode, pos: number, tails: readonly Gap[]): void => {
    if (skip.has(pos)) return
    const box = boxOf(pos)
    if (box === null) return
    const end: Gap = { pos: pos + node.nodeSize, left: box.left }
    const nested: Array<{ node: ProseMirrorNode; pos: number }> = []
    if (nest && isListNode(node)) {
      node.forEach((child, offset, index) => {
        if (index > 0 && isListNode(child)) nested.push({ node: child, pos: pos + 1 + offset })
      })
    }
    const first = nested[0]
    const firstBox = first === undefined ? null : boxOf(first.pos)
    if (first === undefined || firstBox === null) {
      rows.push({
        top: box.top,
        bottom: box.bottom,
        before: { pos, left: box.left },
        after: [end, ...tails],
      })
      return
    }
    // The item's own line: below it is its first child's place.
    rows.push({
      top: box.top,
      bottom: firstBox.top,
      before: { pos, left: box.left },
      after: [{ pos: first.pos, left: firstBox.left }],
    })
    const last = nested[nested.length - 1]
    const closesItem = last !== undefined && last.pos + last.node.nodeSize === end.pos - 1
    for (const child of nested) {
      visit(child.node, child.pos, child === last && closesItem ? [end, ...tails] : [])
    }
  }

  doc.forEach((node, offset) => visit(node, offset, []))
  return rows
}

/**
 * The gap for a finger at (`x`, `y`): the row under it (the nearest one when
 * it is past either end), split at its middle. The marker sits halfway
 * between the two blocks the gap separates.
 */
export function dropSlotAt(rows: readonly DropRow[], x: number, y: number): DropSlot | null {
  if (rows.length === 0) return null
  let index = rows.findIndex((row) => y < row.bottom)
  if (index === -1) index = rows.length - 1
  const row = rows[index]
  if (row === undefined) return null
  if (y < (row.top + row.bottom) / 2) {
    const above = rows[index - 1]
    const edge = above === undefined ? row.top : (above.bottom + row.top) / 2
    return { pos: row.before.pos, left: row.before.left, y: edge }
  }
  const below = rows[index + 1]
  const edge = below === undefined ? row.bottom : (row.bottom + below.top) / 2
  // The deepest level the finger has not slid left of; the outermost otherwise.
  const gap = row.after.find((level) => level.left <= x) ?? row.after[row.after.length - 1]
  if (gap === undefined) return null
  return { pos: gap.pos, left: gap.left, y: edge }
}
