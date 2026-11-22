import { Fragment, type Node as ProseMirrorNode } from '@prosekit/pm/model'
import { TextSelection, type EditorState, type Transaction } from '@prosekit/pm/state'
import {
  blockRangeAt,
  isListNode,
  withBlockSelection,
  type BlockRange,
} from './block-selection-plugin'

/**
 * Reordering whole blocks: the one move every surface shares (the iPhone
 * drag, the arrows over the block action bar, the arrows on the keyboard
 * toolbar). A block is what {@link blockRangeAt} says it is: a list item with
 * its children, else a top-level block.
 */

export type MoveDirection = 'up' | 'down'

/** A finished move: the transaction, and where each moved block now starts. */
export interface BlockMove {
  tr: Transaction
  starts: readonly number[]
}

/** Whether `blocks` (in document order) sit side by side with nothing between them. */
function contiguous(blocks: readonly BlockRange[]): boolean {
  return blocks.every((block, index) => index === 0 || blocks[index - 1]?.to === block.from)
}

/**
 * Whether dropping `blocks` (in document order) at `target` would leave the
 * document as it is, or has nowhere to land (inside one of the blocks).
 */
export function isIdleMove(blocks: readonly BlockRange[], target: number): boolean {
  const first = blocks[0]
  const last = blocks[blocks.length - 1]
  if (first === undefined || last === undefined) return true
  if (blocks.some((block) => target > block.from && target < block.to)) return true
  return contiguous(blocks) && target >= first.from && target <= last.to
}

/**
 * Lift `blocks` (in document order) out of the document and set them down
 * together at `target`, a gap between two blocks. Returns null when nothing
 * would change or the document would not allow it (a list item left with no
 * content, a block where its kind cannot go).
 */
export function moveBlocks(
  state: EditorState,
  blocks: readonly BlockRange[],
  target: number,
): BlockMove | null {
  if (isIdleMove(blocks, target)) return null
  const tr = state.tr
  try {
    for (let index = blocks.length - 1; index >= 0; index--) {
      const block = blocks[index]
      if (block !== undefined) tr.delete(block.from, block.to)
    }
    const at = tr.mapping.map(target)
    tr.insert(at, Fragment.from(blocks.map((block) => block.node)))
    const starts: number[] = []
    let start = at
    for (const block of blocks) {
      starts.push(start)
      start += block.node.nodeSize
    }
    return { tr, starts }
  } catch {
    // ProseMirror refuses a step whose result breaks the schema.
    return null
  }
}

/** The move's transaction with the moved blocks as the block selection. */
export function keepSelected(move: BlockMove): Transaction {
  return withBlockSelection(move.tr, {
    type: 'set',
    anchors: move.starts.map((start) => start + 1),
  })
}

/**
 * Where `blocks` (in document order) land when they step one place among
 * their siblings: before the block above the first, or after the block below
 * the last. Null at the edge of their parent, when they do not share one, and
 * for a step that would put a nested item above its parent's own line.
 */
export function siblingMoveTarget(
  doc: ProseMirrorNode,
  blocks: readonly BlockRange[],
  direction: MoveDirection,
): number | null {
  const first = blocks[0]
  const last = blocks[blocks.length - 1]
  if (first === undefined || last === undefined) return null
  const $first = doc.resolve(first.from)
  const parent = $first.parent
  // Same parent by position: equal nodes can be one shared object.
  if (blocks.some((block) => doc.resolve(block.from).start() !== $first.start())) return null
  if (direction === 'up') {
    const index = $first.index()
    const floor =
      isListNode(parent) && parent.firstChild !== null && !isListNode(parent.firstChild) ? 1 : 0
    if (index <= floor) return null
    return first.from - parent.child(index - 1).nodeSize
  }
  const index = doc.resolve(last.to).index()
  if (index >= parent.childCount) return null
  return last.to + parent.child(index).nodeSize
}

/** The block the caret is in, when the whole selection stays inside it. */
function caretBlock(state: EditorState): BlockRange | null {
  const { from, to } = state.selection
  const block = blockRangeAt(state.doc, from)
  if (block === null || to > block.to) return null
  return block
}

/**
 * Step the block the caret is in one place up or down, the caret travelling
 * with it. Null when it cannot move that way.
 */
export function moveCaretBlock(state: EditorState, direction: MoveDirection): Transaction | null {
  const block = caretBlock(state)
  if (block === null) return null
  const target = siblingMoveTarget(state.doc, [block], direction)
  if (target === null) return null
  const move = moveBlocks(state, [block], target)
  const start = move?.starts[0]
  if (move === null || start === undefined) return null
  const { anchor, head } = state.selection
  const shift = start - block.from
  return move.tr
    .setSelection(TextSelection.create(move.tr.doc, anchor + shift, head + shift))
    .scrollIntoView()
}
