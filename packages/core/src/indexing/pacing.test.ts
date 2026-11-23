import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPassPacer, INDEX_PASS_WORK_BUDGET_MS, INDEX_PASS_YIELD_EVERY } from './pacing'

afterEach(() => {
  vi.restoreAllMocks()
})

/** A pacer on a clock the test advances by hand. */
function pacerOnClock(): {
  pause: () => Promise<boolean>
  advance: (ms: number) => void
} {
  let now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  const pacer = createPassPacer()
  return {
    pause: pacer.pause,
    advance: (ms) => {
      now += ms
    },
  }
}

describe('createPassPacer', () => {
  it('keeps going while the work budget is unspent', async () => {
    const { pause, advance } = pacerOnClock()
    advance(INDEX_PASS_WORK_BUDGET_MS - 1)
    expect(await pause()).toBe(false)
  })

  it('breaks once the budget is spent, however few files that took', async () => {
    const { pause, advance } = pacerOnClock()
    advance(INDEX_PASS_WORK_BUDGET_MS)
    expect(await pause()).toBe(true)
    // The break restarts the budget.
    expect(await pause()).toBe(false)
  })

  it('breaks after a full run of files even when the clock never moves', async () => {
    const { pause } = pacerOnClock()
    const breaks: boolean[] = []
    for (let file = 0; file < INDEX_PASS_YIELD_EVERY * 2; file += 1) {
      breaks.push(await pause())
    }
    expect(breaks.filter(Boolean)).toHaveLength(2)
    expect(breaks[INDEX_PASS_YIELD_EVERY - 1]).toBe(true)
  })
})
