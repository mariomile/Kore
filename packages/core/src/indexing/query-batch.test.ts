import { afterEach, describe, expect, it, vi } from 'vitest'
import { setBridge } from '../ipc/bridge'
import { queryBatch } from './db'

afterEach(() => {
  setBridge(null)
})

describe('queryBatch', () => {
  it('skips IPC when there is nothing to run', async () => {
    const invoke = vi.fn()
    setBridge({ invoke, listen: async () => () => {} })
    expect(await queryBatch([])).toEqual([])
    expect(invoke).not.toHaveBeenCalled()
  })

  it('ships every query in one db_query_batch invoke', async () => {
    const invoke = vi.fn(async () => [[{ path: 'a' }], [{ path: 'b' }]])
    setBridge({ invoke, listen: async () => () => {} })
    const rows = await queryBatch<{ path: string }>([
      { sql: 'SELECT 1', params: [1] },
      { sql: 'SELECT 2', params: [2] },
    ])
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('db_query_batch', {
      queries: [
        { sql: 'SELECT 1', params: [1] },
        { sql: 'SELECT 2', params: [2] },
      ],
    })
    expect(rows).toEqual([[{ path: 'a' }], [{ path: 'b' }]])
  })

  it('rejects a malformed batch payload', async () => {
    setBridge({
      invoke: async () => [{ not: 'rows' }],
      listen: async () => () => {},
    })
    await expect(queryBatch([{ sql: 'SELECT 1', params: [] }])).rejects.toThrow(/row arrays/)
  })
})
