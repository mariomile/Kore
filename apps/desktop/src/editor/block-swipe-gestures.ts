/**
 * The gesture half of Craft-style block handling: when a sideways drag on a
 * block becomes a swipe, where it commits, and how far the block follows the
 * finger.
 *
 * Kept as pure functions so the thresholds — the part that decides whether a
 * gesture feels deliberate or fires while someone is scrolling — are testable
 * without a webview.
 */

/** Horizontal travel that commits a swipe, in CSS pixels. */
export const SWIPE_COMMIT_PX = 44

/**
 * How far back a committed swipe has to come before it lets go again. The gap
 * keeps a finger resting near the threshold from flickering the selection on
 * and off.
 */
const UNCOMMIT_PX = SWIPE_COMMIT_PX - 12

/** Horizontal travel at which a drag can declare itself a swipe. */
const CLAIM_PX = 10

/**
 * How much more horizontal than vertical the drag must be to read as a swipe
 * rather than a scroll. A finger travelling down the page always carries some
 * sideways drift; requiring the horizontal component to lead keeps the page
 * scrolling instead of selecting whatever it passed over.
 */
const HORIZONTAL_DOMINANCE = 1.3

/**
 * Vertical travel, after a block is selected, that turns the swipe into a
 * sweep over the blocks above or below. Well past a finger's natural drift,
 * so a swipe on a short line never takes its neighbour with it.
 */
export const SWEEP_START_PX = 24

/** Past the commit point the block keeps following, with this much give. */
const FOLLOW_RESISTANCE = 0.3
/** The furthest a swiped block travels, however far the finger goes. */
export const FOLLOW_MAX_PX = 88

/**
 * The way a selecting swipe travels along x: right to left (Mario,
 * 2026-11-18). Every direction-dependent check derives from this sign, so the
 * gesture flips in one place.
 */
export const SELECT_DIRECTION = -1

/** How far a drag has travelled toward selecting; negative when it went the other way. */
export function selectTravel(deltaX: number): number {
  return deltaX * SELECT_DIRECTION
}

/**
 * What a swipe means for the block under it: toward {@link SELECT_DIRECTION}
 * selects it as a block, the other way runs the quick action.
 */
export type BlockSwipe = 'select' | 'action'

export function swipeIntent(deltaX: number): BlockSwipe {
  return selectTravel(deltaX) > 0 ? 'select' : 'action'
}

/**
 * Whether a drag in progress has declared itself horizontal — the point at
 * which the handler claims the gesture and stops the page scrolling under it.
 * Early, before iOS starts its own scroll: once the page scrolls the gesture
 * is the scroll's for good, so claiming late gives half a swipe and half a
 * scroll.
 */
export function isHorizontalDrag(deltaX: number, deltaY: number): boolean {
  return Math.abs(deltaX) >= CLAIM_PX && Math.abs(deltaX) > Math.abs(deltaY) * HORIZONTAL_DOMINANCE
}

/**
 * Whether a claimed swipe is committed now, given whether it was a moment
 * ago. Only horizontal travel counts: once the gesture is claimed the page
 * no longer scrolls, so a finger drifting down keeps the swipe.
 */
export function isCommitted(deltaX: number, wasCommitted: boolean): boolean {
  return Math.abs(deltaX) >= (wasCommitted ? UNCOMMIT_PX : SWIPE_COMMIT_PX)
}

/**
 * Where the swiped block sits for a finger `deltaX` along: with the finger up
 * to the commit point, then with growing resistance, never past
 * {@link FOLLOW_MAX_PX}.
 */
export function followOffset(deltaX: number): number {
  const travel = Math.abs(deltaX)
  const beyond = Math.max(0, travel - SWIPE_COMMIT_PX)
  const offset = Math.min(travel, SWIPE_COMMIT_PX) + beyond * FOLLOW_RESISTANCE
  return Math.sign(deltaX) * Math.min(offset, FOLLOW_MAX_PX)
}
