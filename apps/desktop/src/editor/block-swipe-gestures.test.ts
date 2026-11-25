import { describe, expect, it } from 'vitest'
import {
  followOffset,
  FOLLOW_MAX_PX,
  isCommitted,
  isHorizontalDrag,
  swipeIntent,
  SWIPE_COMMIT_PX,
} from './block-swipe-gestures'

describe('swipeIntent', () => {
  it('reads a leftward drag as select and a rightward one as the quick action', () => {
    expect(swipeIntent(-20)).toBe('select')
    expect(swipeIntent(20)).toBe('action')
  })
})

describe('isHorizontalDrag', () => {
  it('claims a sideways drag early, before the page would scroll', () => {
    expect(isHorizontalDrag(-10, 2)).toBe(true)
    expect(isHorizontalDrag(12, 8)).toBe(true)
  })

  it('does not claim a vertical, diagonal or barely-moved drag', () => {
    expect(isHorizontalDrag(8, 0)).toBe(false)
    expect(isHorizontalDrag(20, 20)).toBe(false)
    expect(isHorizontalDrag(60, 120)).toBe(false)
  })
})

describe('isCommitted', () => {
  it('commits at the threshold either way', () => {
    expect(isCommitted(-(SWIPE_COMMIT_PX - 1), false)).toBe(false)
    expect(isCommitted(-SWIPE_COMMIT_PX, false)).toBe(true)
    expect(isCommitted(SWIPE_COMMIT_PX, false)).toBe(true)
  })

  it('holds a committed swipe a little below the threshold, so it never flickers', () => {
    expect(isCommitted(-(SWIPE_COMMIT_PX - 4), true)).toBe(true)
    expect(isCommitted(-(SWIPE_COMMIT_PX - 20), true)).toBe(false)
  })
})

describe('followOffset', () => {
  it('moves with the finger up to the commit point', () => {
    expect(followOffset(-30)).toBe(-30)
    expect(followOffset(SWIPE_COMMIT_PX)).toBe(SWIPE_COMMIT_PX)
  })

  it('gives way past it, and never runs off', () => {
    const beyond = followOffset(-(SWIPE_COMMIT_PX + 40))
    expect(beyond).toBeLessThan(-SWIPE_COMMIT_PX)
    expect(beyond).toBeGreaterThan(-(SWIPE_COMMIT_PX + 40))
    expect(followOffset(-1000)).toBe(-FOLLOW_MAX_PX)
  })
})
