import type { EditorView } from '@prosekit/pm/view'
import { isIdleMove, keepSelected, moveBlocks } from './block-move'
import { buildDropRows, dropSlotAt, type BlockBox, type DropSlot } from './block-drop-slots'
import { isListNode, selectedBlocks, type BlockRange } from './block-selection-plugin'

/**
 * Dragging the selected blocks to another place in the note, on touch: the
 * blocks lift and follow the finger, a marker shows the gap they would land
 * in, the note scrolls when the finger nears its top or bottom, and letting
 * go sets them down there.
 *
 * Everything the finger's moves need is measured once at the start
 * ({@link buildDropRows}); a move then only sets an animation's time and the
 * marker's transform, so the drag costs no layout. The blocks follow through
 * a paused Web Animation, never an inline style, which ProseMirror would
 * read as an edit and redraw.
 */

export interface BlockDrag {
  move: (x: number, y: number) => void
  /** Let go: the blocks land in the marked gap, or settle back with none. */
  drop: () => void
  /** Abandon the drag: the blocks settle back where they were. */
  cancel: () => void
}

/** Travel either way the follow animation spans; far past any note's height. */
const FOLLOW_REACH_PX = 50_000
/** How near the scroller's top or bottom the finger starts scrolling the note. */
const SCROLL_ZONE_PX = 88
const SCROLL_MAX_PX_PER_FRAME = 16
const SETTLE_MS = 220
const SETTLE_EASING = 'cubic-bezier(0.2, 0.9, 0.3, 1)'
/**
 * A lifted block: over its neighbours, a shadow under it, and a little of
 * the note showing through so the drop marker reads behind it.
 */
const LIFTED: Keyframe = {
  filter: 'drop-shadow(0 10px 14px rgb(0 0 0 / 0.2))',
  opacity: 0.88,
  zIndex: 5,
}
const RESTING: Keyframe = { filter: 'drop-shadow(0 0 0 rgb(0 0 0 / 0))', opacity: 1, zIndex: 5 }
const MARKER_HEIGHT_PX = 3
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

/** Slide each element from where it was on screen (`tops`) to where it now sits. */
function settle(elements: readonly (HTMLElement | null)[], tops: readonly number[]): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  for (const [index, element] of elements.entries()) {
    const from = tops[index]
    if (element === null || from === undefined) continue
    const offset = from - element.getBoundingClientRect().top
    element.animate(
      [
        { transform: `translateY(${offset}px)`, ...LIFTED },
        { transform: 'translateY(0)', ...RESTING },
      ],
      { duration: SETTLE_MS, easing: SETTLE_EASING },
    )
  }
}

/**
 * Start dragging the view's selected blocks from a finger at `startY`.
 * `onStep` fires each time the marker moves to another gap (the haptic
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
  const content = view.dom.getBoundingClientRect()
  const markerRight = content.right - parseFloat(getComputedStyle(view.dom).paddingRight)

  const boxOf = (pos: number): BlockBox | null => {
    const bounds = elementAt(view, pos)?.getBoundingClientRect()
    return bounds === undefined
      ? null
      : { top: bounds.top, bottom: bounds.bottom, left: bounds.left }
  }
  const rows = buildDropRows(
    doc,
    blocks,
    boxOf,
    blocks.every((block) => isListNode(block.node)),
  )

  const gather = gatherOffsets(
    blocks,
    lifted.map((element) => element.getBoundingClientRect()),
    startY,
  )
  const gathers = gather.some((offset) => offset !== 0)
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

  const marker = document.createElement('div')
  marker.className = 'kore-block-drop-marker'
  marker.hidden = true
  document.body.append(marker)

  let target: DropSlot | null = null
  let fingerX = 0
  let fingerY = startY
  let scrollFrame = 0
  let gatherFrame = 0
  let done = false

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
    const slot = dropSlotAt(rows, fingerX, fingerY + scrolled)
    const next = slot === null || isIdleMove(blocks, slot.pos) ? null : slot
    if (next !== null && next.pos !== target?.pos) onStep()
    target = next
    marker.hidden = next === null
    if (next !== null) {
      marker.style.width = `${Math.max(0, markerRight - next.left)}px`
      marker.style.transform = `translate(${next.left}px, ${next.y - scrolled - MARKER_HEIGHT_PX / 2}px)`
    }
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
    marker.remove()
    const tops = lifted.map((element) => element.getBoundingClientRect().top)
    for (const follow of follows) follow.cancel()
    if (view.isDestroyed) return
    // A note that changed under the drag (a sync) has moved every position.
    const move =
      commit && target !== null && view.state.doc === doc
        ? moveBlocks(view.state, blocks, target.pos)
        : null
    if (move === null) {
      settle(lifted, tops)
      return
    }
    view.dispatch(keepSelected(move))
    settle(
      move.starts.map((start) => elementAt(view, start)),
      tops,
    )
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
