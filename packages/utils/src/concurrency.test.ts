import { describe, expect, it } from 'vitest'
import { forEachConcurrent } from './concurrency'

describe('forEachConcurrent', () => {
  it('visits every item once with no more than `limit` in flight', async () => {
    let inFlight = 0
    let peak = 0
    const seen: number[] = []
    await forEachConcurrent([5, 1, 4, 2, 3], 2, async (delay, index) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, delay))
      seen[index] = delay
      inFlight -= 1
    })
    expect(seen).toEqual([5, 1, 4, 2, 3])
    expect(peak).toBe(2)
  })

  it('does nothing for no items', async () => {
    let calls = 0
    await forEachConcurrent([], 8, async () => {
      calls += 1
    })
    expect(calls).toBe(0)
  })
})
