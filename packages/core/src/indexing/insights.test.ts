import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setBridge } from '../ipc/bridge'
import { PROJECTION_VERSION } from './indexed-note'
import { listPrivateNotePaths } from './insights'

// Same fake-bridge harness as queries.test / pipeline.test: `db_query` resolves
// here, so these exercise the real compiled SQL and the real call ordering.
const mockInvoke = vi.fn<(command: string, args: Record<string, unknown>) => Promise<unknown>>()

beforeEach(() => {
  mockInvoke.mockReset()
  setBridge({ invoke: mockInvoke, listen: async () => () => {} })
})

afterEach(() => {
  setBridge(null)
})

/** Resolve the projection stamp, then whatever the note query should return. */
function scriptIndex(stamp: string | null, privateRows: { path: string }[]): void {
  mockInvoke
    .mockResolvedValueOnce(stamp === null ? [] : [{ value: stamp }])
    .mockResolvedValueOnce(privateRows)
}

describe('listPrivateNotePaths', () => {
  it('lists the private notes when the projection is current', async () => {
    scriptIndex(String(PROJECTION_VERSION), [{ path: 'notes/diary.md' }, { path: 'notes/pay.md' }])

    await expect(listPrivateNotePaths()).resolves.toEqual(['notes/diary.md', 'notes/pay.md'])

    const sql = String(mockInvoke.mock.calls[1]![1]['sql'])
    expect(sql).toContain('is_private')
  })

  it('returns null while a rebuild is in flight, without reading the notes table', async () => {
    // The stamp is written only once a rebuild finishes, so an older value is
    // exactly the state where `notes` has been wiped and is refilling. An
    // empty result here would be indistinguishable from "no private notes".
    scriptIndex(String(PROJECTION_VERSION - 1), [])

    await expect(listPrivateNotePaths()).resolves.toBeNull()
    // The refusal must not depend on the notes query returning anything: the
    // point is that we never ask a table that is mid-refill.
    expect(mockInvoke).toHaveBeenCalledTimes(1)
  })

  it('returns null on a never-stamped index rather than an empty list', async () => {
    scriptIndex(null, [])

    await expect(listPrivateNotePaths()).resolves.toBeNull()
    expect(mockInvoke).toHaveBeenCalledTimes(1)
  })

  it('distinguishes a current-but-empty graph from an unavailable one', async () => {
    // A graph with no private notes is a real, complete answer: the empty
    // array must survive, or callers would refuse forever on a clean vault.
    scriptIndex(String(PROJECTION_VERSION), [])

    await expect(listPrivateNotePaths()).resolves.toEqual([])
  })
})
