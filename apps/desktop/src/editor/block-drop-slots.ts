import type { Node as ProseMirrorNode } from '@prosekit/pm/model'
import { isListNode, type BlockRange } from './block-selection-plugin'

/**
 * Where a dragged block may land, worked out once when the drag starts so the
 * finger's every move is a lookup with no layout read.
 *
 * The note is cut into rows: a top-level block is one row, and a list item is
 * the row of its own line with its nested items as rows of their own. The
 * lower half of a row and the upper half of the row under it are the same
 * place, the gap between the two. Under the last item of a nested list that
 * gap is ambiguous (still nested, or out at one of the levels above), so it
 * offers every level and the finger's horizontal position picks: slide left
 * to step out. A dragged block keeps its row, so the gaps around the place it
 * was lifted from stay where they were.
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
  /** Where the row's block starts in the document. */
  pos: number
  top: number
  bottom: number
  /** The row is an item's own line only: its nested items are rows of their own. */
  ownLine: boolean
  /** The row is a dragged block, whole. */
  lifted: boolean
  before: Gap
  /** Deepest level first. */
  after: readonly Gap[]
}

/** The gap under the finger: where it is in the document and on the page. */
export interface DropSlot {
  pos: number
  y: number
  left: number
}

/**
 * The rows of `doc`, top to bottom. `boxOf`
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
  const lifted = new Set(dragged.map((block) => block.from))
  const rows: DropRow[] = []

  const visit = (node: ProseMirrorNode, pos: number, tails: readonly Gap[]): void => {
    const box = boxOf(pos)
    if (box === null) return
    const end: Gap = { pos: pos + node.nodeSize, left: box.left }
    const whole = { pos, top: box.top, bottom: box.bottom, ownLine: false }
    if (lifted.has(pos)) {
      rows.push({ ...whole, lifted: true, before: { pos, left: box.left }, after: [end, ...tails] })
      return
    }
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
        ...whole,
        lifted: false,
        before: { pos, left: box.left },
        after: [end, ...tails],
      })
      return
    }
    // The item's own line: below it is its first child's place.
    rows.push({
      pos,
      top: box.top,
      bottom: firstBox.top,
      ownLine: true,
      lifted: false,
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

/** The deepest of `levels` the finger at `x` has not slid left of; the outermost otherwise. */
function levelAt(levels: readonly Gap[], x: number): Gap | undefined {
  return levels.find((level) => level.left <= x) ?? levels[levels.length - 1]
}

/**
 * The gap for a finger at (`x`, `y`): the row under it (the nearest one when
 * it is past either end), split at its middle. Its `y` is halfway between
 * the two blocks the gap separates.
 */
export function dropSlotAt(rows: readonly DropRow[], x: number, y: number): DropSlot | null {
  if (rows.length === 0) return null
  let index = rows.findIndex((row) => y < row.bottom)
  if (index === -1) index = rows.length - 1
  const row = rows[index]
  if (row === undefined) return null
  const upper = y < (row.top + row.bottom) / 2
  const above = upper ? rows[index - 1] : row
  const below = upper ? row : rows[index + 1]
  // The gap's levels are the upper row's; the lower row's own start joins
  // them when the upper row does not reach it (it ends inside its item).
  const levels =
    above === undefined ||
    below === undefined ||
    above.after.some((gap) => gap.pos === below.before.pos)
      ? (above?.after ?? [row.before])
      : [...above.after, below.before]
  const gap = levelAt(levels, x)
  if (gap === undefined) return null
  const edge =
    above === undefined
      ? row.top
      : below === undefined
        ? row.bottom
        : (above.bottom + below.top) / 2
  return { pos: gap.pos, left: gap.left, y: edge }
}
