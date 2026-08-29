/**
 * The gesture half of Craft-style block handling: how far a horizontal drag
 * has to travel before it counts as a block swipe, and which way it went.
 *
 * Kept as pure functions so the thresholds — the part that decides whether a
 * gesture feels deliberate or fires while someone is scrolling — are testable
 * without a webview.
 */

/** Horizontal travel that commits a swipe, in CSS pixels. */
export const SWIPE_COMMIT_PX = 44

/**
 * How much more horizontal than vertical the drag must be to read as a swipe
 * rather than a scroll. A finger travelling down the page always carries some
 * sideways drift; requiring the horizontal component to dominate keeps the
 * page scrolling instead of re-indenting whatever it passed over.
 */
const HORIZONTAL_DOMINANCE = 1.7

/** Vertical travel past which the gesture is a scroll, whatever the ratio. */
const SCROLL_ESCAPE_PX = 34

/** What one finished drag means for the block under it. */
export type BlockSwipe = 'indent' | 'outdent' | null

/**
 * Classify a drag by its total displacement. Returns `null` for anything that
 * is not a committed, clearly horizontal swipe — the caller then leaves the
 * gesture to the browser.
 */
export function classifyBlockSwipe(deltaX: number, deltaY: number): BlockSwipe {
  const horizontal = Math.abs(deltaX)
  const vertical = Math.abs(deltaY)
  if (horizontal < SWIPE_COMMIT_PX || vertical > SCROLL_ESCAPE_PX) {
    return null
  }
  if (horizontal < vertical * HORIZONTAL_DOMINANCE) {
    return null
  }
  return deltaX > 0 ? 'indent' : 'outdent'
}

/**
 * Whether a drag in progress has declared itself horizontal — the point at
 * which the handler claims the gesture (and stops the page scrolling under
 * it). Deliberately earlier than {@link classifyBlockSwipe}'s commit
 * threshold: claiming only at commit would let the page scroll for the first
 * half of every swipe and then jump back.
 */
export function isHorizontalDrag(deltaX: number, deltaY: number): boolean {
  return Math.abs(deltaX) > 12 && Math.abs(deltaX) > Math.abs(deltaY) * HORIZONTAL_DOMINANCE
}
