import type { EditorView } from '@prosekit/pm/view'
import { isIdleMove, keepSelected, moveBlocks } from './block-move'
import {
  buildDropRows,
  dropSlotAt,
  type BlockBox,
  type DropRow,
  type DropSlot,
} from './block-drop-slots'
import { createSlide, LANDING, LIFTED, placeOf, settle, type Slide } from './block-drag-motion'
import { isListNode, selectedBlocks, type BlockRange } from './block-selection-plugin'

/**
 * Dragging the selected blocks to another place in the note, on touch: the
 * blocks lift and follow the finger, the blocks around them part to open the
 * place they would land in (as rows do in an iOS list), the note scrolls when
 * the finger nears its top or bottom, and letting go sets them down there.
 *
 * Everything the finger's moves need is measured once at the start
 * ({@link buildDropRows}); a move then only sets an animation's time, and a
 * change of landing place starts transform animations, so the drag costs no
 * layout. Every motion is a Web Animation, never an inline style, which
 * ProseMirror would read as an edit and redraw.
 */

export interface BlockDrag {
  move: (x: number, y: number) => void
  /** Let go: the blocks land in the open place, or settle back with none. */
  drop: () => void
  /** Abandon the drag: the blocks settle back where they were. */
  cancel: () => void
}

/** Travel either way the follow animation spans; far past any note's height. */
const FOLLOW_REACH_PX = 50_000
/** How near the scroller's top or bottom the finger starts scrolling the note. */
const SCROLL_ZONE_PX = 88
const SCROLL_MAX_PX_PER_FRAME = 16
/** Blocks picked apart close up into one stack as they lift. */
const GATHER_MS = 180
const GATHER_GAP_PX = 8

function scrollerOf(element: HTMLElement): HTMLElement {
  for (let node = element.parentElement; node !== null; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node
    }
  }
  return document.documentElement
}

function elementAt(view: EditorView, pos: number): HTMLElement | null {
  const node = view.nodeDOM(pos)
  return node instanceof HTMLElement ? node : null
}

/**
 * How far each lifted block shifts so that blocks picked apart travel as one
 * stack around the block under the finger. Neighbours keep the spacing they
 * have; a block from elsewhere closes up to `GATHER_GAP_PX`.
 */
function gatherOffsets(
  blocks: readonly BlockRange[],
  boxes: readonly DOMRect[],
  fingerY: number,
): number[] {
  const held = Math.max(
    0,
    boxes.findIndex((box) => fingerY >= box.top && fingerY <= box.bottom),
  )
  const offsets = boxes.map(() => 0)
  const gap = (upper: number): number => {
    const above = boxes[upper]
    const below = boxes[upper + 1]
    if (above === undefined || below === undefined) return 0
    const adjacent = blocks[upper]?.to === blocks[upper + 1]?.from
    return adjacent ? 0 : GATHER_GAP_PX - (below.top - above.bottom)
  }
  for (let index = held + 1; index < boxes.length; index++) {
    offsets[index] = (offsets[index - 1] ?? 0) + gap(index - 1)
  }
  for (let index = held - 1; index >= 0; index--) {
    offsets[index] = (offsets[index + 1] ?? 0) - gap(index)
  }
  return offsets
}

/**
 * What moves when a row's block makes room: the block, or for an item whose
 * nested items are rows of their own, the parts of its own line.
 */
function rowElements(view: EditorView, pos: number, ownLine: boolean): HTMLElement[] {
  const element = elementAt(view, pos)
  if (element === null) return []
  if (!ownLine) return [element]
  return [...element.children]
    .flatMap((child) =>
      child.classList.contains('list-content')
        ? [...child.children].filter((part) => !part.classList.contains('prosemirror-flat-list'))
        : [child],
    )
    .filter((part): part is HTMLElement => part instanceof HTMLElement)
}

/** A row that makes room, and how far up the lifted blocks above it let it close. */
interface Neighbour {
  row: DropRow
  closes: number
}

/**
 * The rows that part around the lifted ones, and the height the lifted blocks hold open between them in all.
 */
function neighboursOf(rows: readonly DropRow[]): { neighbours: Neighbour[]; room: number } {
  const neighbours: Neighbour[] = []
  let room = 0
  for (const [index, row] of rows.entries()) {
    if (row.lifted) room += (rows[index + 1]?.top ?? row.bottom) - row.top
    else neighbours.push({ row, closes: room })
  }
  return { neighbours, room }
}

/**
 * Start dragging the view's selected blocks from a finger at `startY`.
 * `onStep` fires each time another place opens for them (the haptic
 * tick). Null when there is nothing on screen to drag.
 */
export function startBlockDrag(
  view: EditorView,
  startY: number,
  onStep: () => void,
): BlockDrag | null {
  const doc = view.state.doc
  const blocks = selectedBlocks(view.state)
  const lifted = blocks.flatMap((block) => elementAt(view, block.from) ?? [])
  if (blocks.length === 0 || lifted.length !== blocks.length) return null

  const scroller = scrollerOf(view.dom)
  const scrollStart = scroller.scrollTop
  const scrollMax = scroller.scrollHeight - scroller.clientHeight
  const frame = scroller.getBoundingClientRect()
  // The block action bar covers the scroller's foot; it publishes its height.
  const bar = parseFloat(document.documentElement.style.getPropertyValue('--mobile-tab-bar-height'))
  const visibleTop = Math.max(frame.top, 0)
  const visibleBottom = Math.min(frame.bottom, window.innerHeight) - (Number.isNaN(bar) ? 0 : bar)
  const boxOf = (pos: number): BlockBox | null => {
    const bounds = elementAt(view, pos)?.getBoundingClientRect()
    return bounds === undefined
      ? null
      : { top: bounds.top, bottom: bounds.bottom, left: bounds.left }
  }
  // Only list items take a level: any other block lands between top-level ones.
  const nests = blocks.every((block) => isListNode(block.node))
  const rows = buildDropRows(doc, blocks, boxOf, nests)
  const { neighbours, room } = neighboursOf(rows)
  const parts = new Map<DropRow, Slide>()

  const liftedBoxes = lifted.map((element) => element.getBoundingClientRect())
  const levels = nests ? lifted.map((element) => createSlide([element], 'X', 'add')) : []
  const gather = gatherOffsets(blocks, liftedBoxes, startY)
  const gathers = gather.some((offset) => offset !== 0)
  // The stack's edges once gathered: its leading one is what reaches a place.
  const stackTop = Math.min(...liftedBoxes.map((box, index) => box.top + (gather[index] ?? 0)))
  const stackBottom = Math.max(
    ...liftedBoxes.map((box, index) => box.bottom + (gather[index] ?? 0)),
  )
  const startedAt = performance.now()

  const follows = lifted.map((element) => {
    const follow = element.animate(
      [
        { transform: `translateY(${-FOLLOW_REACH_PX}px)`, ...LIFTED },
        { transform: `translateY(${FOLLOW_REACH_PX}px)`, ...LIFTED },
      ],
      { duration: FOLLOW_REACH_PX * 2, fill: 'both', easing: 'linear' },
    )
    follow.pause()
    follow.currentTime = FOLLOW_REACH_PX
    return follow
  })

  let target: DropSlot | null = null
  let fingerX = 0
  let fingerY = startY
  let scrollFrame = 0
  let gatherFrame = 0
  let done = false

  /**
   * Open the place the blocks would land in: every row under a lifted block
   * closes up over the place it left, and every row under `slot` steps down
   * by all the lifted blocks hold. With no slot the rows stand as they are,
   * the lifted blocks' own places open.
   */
  const makeRoom = (slot: DropSlot | null): void => {
    for (const { row, closes } of neighbours) {
      const offset = slot === null ? 0 : (row.top >= slot.y ? room : 0) - closes
      let part = parts.get(row)
      if (part === undefined) {
        if (offset === 0) continue
        part = createSlide(rowElements(view, row.pos, row.ownLine), 'Y')
        parts.set(row, part)
      }
      part.to(offset)
    }
    for (const [index, level] of levels.entries()) {
      level.to(slot === null ? 0 : slot.left - (liftedBoxes[index]?.left ?? slot.left))
    }
  }

  const update = (): void => {
    const scrolled = scroller.scrollTop - scrollStart
    const travel = Math.max(
      -FOLLOW_REACH_PX,
      Math.min(fingerY - startY + scrolled, FOLLOW_REACH_PX),
    )
    const gathered = gathers ? Math.min((performance.now() - startedAt) / GATHER_MS, 1) : 0
    for (const [index, follow] of follows.entries()) {
      follow.currentTime = FOLLOW_REACH_PX + travel + (gather[index] ?? 0) * gathered
    }
    // A row gives way when the stack's leading edge passes its middle, so
    // the place that opens is the one the stack is drawn over.
    const slot = dropSlotAt(rows, fingerX, (travel > 0 ? stackBottom : stackTop) + travel)
    const next = slot === null || isIdleMove(blocks, slot.pos) ? null : slot
    if (next?.pos === target?.pos) return
    if (next !== null) onStep()
    target = next
    makeRoom(next)
  }

  /** Pixels to scroll this frame for a finger at `y`: faster the nearer the edge. */
  const scrollPace = (y: number): number => {
    const above = visibleTop + SCROLL_ZONE_PX - y
    const below = y - (visibleBottom - SCROLL_ZONE_PX)
    const depth = Math.max(above, below)
    if (depth <= 0) return 0
    const pace = Math.ceil(Math.min(depth / SCROLL_ZONE_PX, 1) * SCROLL_MAX_PX_PER_FRAME)
    return above > below ? -pace : pace
  }

  const scrollStep = (): void => {
    scrollFrame = 0
    const from = scroller.scrollTop
    // Clamped to the note's own length: the lifted blocks' travel must not
    // grow the scrollable area under the finger.
    const to = Math.max(0, Math.min(from + scrollPace(fingerY), scrollMax))
    if (to === from) return
    scroller.scrollTop = to
    update()
    scrollFrame = requestAnimationFrame(scrollStep)
  }

  /** Keep closing the stack up while the finger rests. */
  const gatherStep = (): void => {
    update()
    gatherFrame = performance.now() - startedAt < GATHER_MS ? requestAnimationFrame(gatherStep) : 0
  }
  if (gathers) gatherFrame = requestAnimationFrame(gatherStep)

  const finish = (commit: boolean): void => {
    if (done) return
    done = true
    if (scrollFrame !== 0) cancelAnimationFrame(scrollFrame)
    if (gatherFrame !== 0) cancelAnimationFrame(gatherFrame)
    const from = lifted.map(placeOf)
    for (const follow of follows) follow.cancel()
    for (const level of levels) level.stop()
    if (view.isDestroyed) return
    // A note that changed under the drag (a sync) has moved every position.
    const move =
      commit && target !== null && view.state.doc === doc
        ? moveBlocks(view.state, blocks, target.pos)
        : null
    if (move === null) {
      for (const part of parts.values()) part.rest()
      for (const [index, element] of lifted.entries())
        settle([element], from[index] ?? null, LANDING)
      return
    }
    // The rows already show about where the move puts them; what the guess
    // missed (margins that now collapse differently) settles from where each
    // one showed.
    const shown = neighbours.map(({ row }) => ({
      row,
      place: placeOf(rowElements(view, row.pos, row.ownLine)[0]),
    }))
    for (const part of parts.values()) part.stop()
    view.dispatch(keepSelected(move))
    for (const { row, place } of shown) {
      settle(rowElements(view, move.tr.mapping.map(row.pos), row.ownLine), place)
    }
    for (const [index, start] of move.starts.entries()) {
      const element = elementAt(view, start)
      if (element !== null) settle([element], from[index] ?? null, LANDING)
    }
  }

  return {
    move: (x, y) => {
      if (done) return
      fingerX = x
      fingerY = y
      update()
      if (scrollFrame === 0 && scrollPace(y) !== 0) {
        scrollFrame = requestAnimationFrame(scrollStep)
      }
    },
    drop: () => finish(true),
    cancel: () => finish(false),
  }
}
