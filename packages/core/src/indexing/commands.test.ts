import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setBridge } from '../ipc/bridge'
import { applyIndexedNotes, moveIndexedRows, removeFromIndexBatch } from './commands'
import type { IndexedNote } from './indexed-note'

const invoke = vi.fn<(command: string, args: Record<string, unknown>) => Promise<unknown>>()

beforeEach(() => {
  invoke.mockReset()
  invoke.mockImplementation(async (command) =>
    command === 'db_query' ? [{ tag_key: 'contact', schema_json: '[]', is_private: 0 }] : null,
  )
  setBridge({ invoke, listen: async () => () => {} })
})

afterEach(() => {
  setBridge(null)
})

function commands(): string[] {
  return invoke.mock.calls.map(([command]) => command)
}

const note = (path: string) => ({ path }) as IndexedNote

describe('the tag inheritance pass after index writes (Plan 33 B2)', () => {
  it('runs after a batch that touches a definition note', async () => {
    await applyIndexedNotes([note('people/ada.md'), note('tags/contact.md')], 3)
    expect(commands()).toEqual(['index_apply_batch', 'db_query', 'index_tag_types_resolve'])
    expect(invoke.mock.calls[2]?.[1]).toMatchObject({ generation: 3 })
  })

  it('runs after removing or moving a definition note', async () => {
    await removeFromIndexBatch(['tags/contact.md'], 3)
    await moveIndexedRows('tags/a.md', 'notes/a.md', 3)
    expect(commands().filter((command) => command === 'index_tag_types_resolve')).toHaveLength(2)
  })

  it('logs a failing pass instead of failing the write that already committed', async () => {
    invoke.mockImplementation(async (command) => {
      if (command === 'index_tag_types_resolve') {
        throw new Error('disk full')
      }
      return command === 'db_query'
        ? [{ tag_key: 'contact', schema_json: '[]', is_private: 0 }]
        : null
    })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(applyIndexedNotes([note('tags/contact.md')], 3)).resolves.toBeUndefined()
    expect(logged).toHaveBeenCalledOnce()
    logged.mockRestore()
  })

  it('skips the pass when no definition note is involved', async () => {
    await applyIndexedNotes([note('people/ada.md')], 3)
    await removeFromIndexBatch(['people/ada.md'], 3)
    expect(commands()).toEqual(['index_apply_batch', 'index_remove_batch'])
  })
})
