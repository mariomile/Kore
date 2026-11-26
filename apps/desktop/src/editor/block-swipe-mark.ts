import { SWIPE_COMMIT_PX } from './block-swipe-gestures'

/**
 * The mark a selecting swipe uncovers beside its block: an empty ring that
 * grows in as the block slides away, and fills with the accent and a check
 * the moment the swipe commits. It says where the finger has to get to and
 * that it got there, which a block sliding on its own did not.
 *
 * It lives outside the editor (`position: fixed`, styled by
 * `.kore-swipe-mark`): nothing may be added inside the contenteditable, and a
 * claimed swipe keeps the page from scrolling, so a fixed place stays put.
 */
export interface SwipeMark {
  /** The block is `offset` pixels along toward selecting; `committed` once it is past the commit point. */
  update: (offset: number, committed: boolean) => void
  /** Take the mark away. */
  remove: () => void
}

const CHECK_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'

/** Travel before the ring starts to show, so a tiny drift shows nothing. */
const SHOW_FROM_PX = 8
/** The ring's size at its first showing, against 1 once committed. */
const MIN_SCALE = 0.6
/** The horizontal bleed of a selected block's card (`.kore-block-selected::after`). */
const CARD_BLEED_PX = 10
/**
 * The band the ring centres on: a block's first line (a touch target tall),
 * so on a tall block (a table, a long paragraph) it sits by its top, not
 * halfway down.
 */
const FIRST_LINE_PX = 44

/**
 * A mark beside `box` (the swiped block's place at rest), on the side the
 * block uncovers: `direction` is -1 when the block slides left, so the mark
 * sits by its right edge.
 */
export function createSwipeMark(box: DOMRect, direction: -1 | 1): SwipeMark {
  const mark = document.createElement('div')
  mark.className = 'kore-swipe-mark'
  mark.innerHTML = CHECK_SVG
  const edge = direction < 0 ? box.right + CARD_BLEED_PX : box.left - CARD_BLEED_PX
  mark.style.top = `${box.top + Math.min(box.height, FIRST_LINE_PX) / 2}px`
  mark.style.opacity = '0'
  document.body.appendChild(mark)
  let shownCommitted = false

  return {
    update(offset, committed) {
      const travel = Math.max(0, Math.abs(offset))
      const progress = Math.min(
        1,
        Math.max(0, (travel - SHOW_FROM_PX) / (SWIPE_COMMIT_PX - SHOW_FROM_PX)),
      )
      // Centred in the strip the block has uncovered, card bleed included.
      mark.style.left = `${edge + direction * (travel / 2)}px`
      mark.style.opacity = String(progress)
      mark.style.transform = `scale(${MIN_SCALE + (1 - MIN_SCALE) * (committed ? 1 : progress)})`
      if (committed !== shownCommitted) {
        shownCommitted = committed
        mark.toggleAttribute('data-committed', committed)
      }
    },
    remove() {
      mark.remove()
    },
  }
}
