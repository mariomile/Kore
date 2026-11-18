import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildFolderTree, setBridge } from '@kore/core'
import { queryClient, throttledInvalidateIndexQueries } from './query-client'

const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

/** Grows per test: the throttle keeps module-level state, so each case must
 * start well past the previous one's window to begin on a cold leading edge. */
let clockOffsetMs = 0

beforeEach(() => {
  vi.useFakeTimers()
  clockOffsetMs += 120_000
  vi.setSystemTime(Date.now() + clockOffsetMs)
  invalidateSpy.mockClear()
  invalidateSpy.mockResolvedValue(undefined)
})

afterEach(() => {
  // Drain any armed trailing edge so it can't leak into the next test.
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
})

describe('throttledInvalidateIndexQueries', () => {
  it('fires the first call immediately — a single save keeps its instant refresh', () => {
    throttledInvalidateIndexQueries()
    expect(invalidateSpy).toHaveBeenCalledTimes(1)
  })

  it('collapses a burst into one trailing refetch, none dropped', () => {
    // The initial-sync shape: an applied watch batch every ~2s for minutes.
    throttledInvalidateIndexQueries() // leading
    throttledInvalidateIndexQueries()
    throttledInvalidateIndexQueries()
    throttledInvalidateIndexQueries()
    expect(invalidateSpy).toHaveBeenCalledTimes(1)

    // The trailing edge runs once the window elapses — the last batch's
    // rows are never left stale.
    vi.advanceTimersByTime(3_000)
    expect(invalidateSpy).toHaveBeenCalledTimes(2)

    // Quiet afterwards: nothing further scheduled.
    vi.advanceTimersByTime(10_000)
    expect(invalidateSpy).toHaveBeenCalledTimes(2)
  })

  it('spaces sustained streams to one refetch per window', () => {
    for (let tick = 0; tick < 12; tick += 1) {
      throttledInvalidateIndexQueries()
      vi.advanceTimersByTime(1_000) // a batch per second for 12s
    }
    // Leading + one trailing per 3s window: ~4 rounds, not 12.
    expect(invalidateSpy.mock.calls.length).toBeLessThanOrEqual(5)
    expect(invalidateSpy.mock.calls.length).toBeGreaterThanOrEqual(4)
  })

  it('an isolated call after a quiet period fires immediately again', () => {
    throttledInvalidateIndexQueries()
    vi.advanceTimersByTime(10_000)
    invalidateSpy.mockClear()

    throttledInvalidateIndexQueries()
    expect(invalidateSpy).toHaveBeenCalledTimes(1)
  })
})

describe('narrowed invalidation of the folder tree', () => {
  const treeKey = ['index', '/g', 'folder-tree']

  afterEach(() => {
    setBridge(null)
    queryClient.removeQueries({ queryKey: treeKey })
  })

  function cacheTree(titleInIndex: string): void {
    queryClient.setQueryData(treeKey, buildFolderTree([{ path: 'notes/a.md', title: 'A' }]))
    setBridge({
      invoke: async (command) =>
        command === 'db_query' ? [{ path: 'notes/a.md', title: titleInIndex }] : null,
      listen: async () => () => {},
    })
  }

  const treeRefetches = (): number =>
    invalidateSpy.mock.calls.filter(([filters]) => filters?.exact === true).length

  it('skips the folder tree for a body-only save but refreshes everything else', async () => {
    cacheTree('A')
    throttledInvalidateIndexQueries([{ path: 'notes/a.md', kind: 'upsert' }])
    expect(invalidateSpy).toHaveBeenCalledTimes(1)
    const [filters] = invalidateSpy.mock.calls[0]!
    expect(filters?.predicate?.(queryClient.getQueryCache().find({ queryKey: treeKey })!)).toBe(
      false,
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(treeRefetches()).toBe(0)
  })

  it('refreshes the folder tree when the save retitled the note', async () => {
    cacheTree('A renamed')
    throttledInvalidateIndexQueries([{ path: 'notes/a.md', kind: 'upsert' }])
    await vi.waitFor(() => expect(treeRefetches()).toBe(1))
  })

  it('refreshes everything when a batch in the window came without its changes', () => {
    cacheTree('A')
    throttledInvalidateIndexQueries([{ path: 'notes/a.md', kind: 'upsert' }]) // leading
    throttledInvalidateIndexQueries([{ path: 'notes/a.md', kind: 'upsert' }])
    throttledInvalidateIndexQueries() // e.g. a sync pull: no batch to narrow by
    invalidateSpy.mockClear()
    vi.advanceTimersByTime(3_000)
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['index'] })
  })
})
