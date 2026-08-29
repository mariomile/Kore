import { describe, expect, it } from 'vitest'
import { classifyBlockSwipe, isHorizontalDrag, SWIPE_COMMIT_PX } from './block-swipe-gestures'

describe('classifyBlockSwipe', () => {
  it('reads a committed rightward drag as indent and leftward as outdent', () => {
    expect(classifyBlockSwipe(SWIPE_COMMIT_PX, 0)).toBe('indent')
    expect(classifyBlockSwipe(-SWIPE_COMMIT_PX, 4)).toBe('outdent')
  })

  it('ignores a drag that has not travelled far enough', () => {
    expect(classifyBlockSwipe(SWIPE_COMMIT_PX - 1, 0)).toBeNull()
  })

  it('leaves a scroll alone however far it drifts sideways', () => {
    expect(classifyBlockSwipe(60, 120)).toBeNull()
    expect(classifyBlockSwipe(60, 40)).toBeNull()
  })

  it('still reads a swipe that drifts a little', () => {
    expect(classifyBlockSwipe(80, 20)).toBe('indent')
  })
})

describe('isHorizontalDrag', () => {
  it('claims the gesture well before it commits', () => {
    expect(isHorizontalDrag(20, 2)).toBe(true)
    expect(isHorizontalDrag(20, 2) && classifyBlockSwipe(20, 2) === null).toBe(true)
  })

  it('does not claim a vertical or barely-moved drag', () => {
    expect(isHorizontalDrag(8, 0)).toBe(false)
    expect(isHorizontalDrag(20, 20)).toBe(false)
  })
})
