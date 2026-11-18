import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setBridge } from '../ipc/bridge'
import {
  applyIndexedNotes,
  moveIndexedRows,
  moveNoteIndexed,
  removeFromIndexBatch,
} from './commands'
import { subscribeFileChanges, type FileChange } from './file-changes'
import { setLocalWriteEcho } from './local-write-echo'
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
  setLocalWriteEcho(false)
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

describe('moveNoteIndexed', () => {
  it('echoes the delete+create pair where no watcher does, after the move lands', async () => {
    // Mobile has no watcher: without this echo the Notes list kept a renamed
    // note under its placeholder path, and its card opened an empty note.
    setLocalWriteEcho(true)
    const seen: FileChange[] = []
    const unlisten = await subscribeFileChanges((changes) => {
      seen.push(...changes)
    })
    await moveNoteIndexed('notes/01m7r5y5hah6wv8yw1863caw71.md', 'notes/gta-6.md', 4)
    unlisten()

    expect(commands()).toEqual(['note_move_indexed'])
    expect(seen).toEqual([
      { path: 'notes/01m7r5y5hah6wv8yw1863caw71.md', kind: 'remove' },
      {
        path: 'notes/gta-6.md',
        kind: 'upsert',
        modifiedMs: expect.any(Number),
      },
    ])
  })

  it('echoes nothing when the move is refused', async () => {
    setLocalWriteEcho(true)
    invoke.mockRejectedValue({ kind: 'conflict', message: 'occupied' })
    const seen: FileChange[] = []
    const unlisten = await subscribeFileChanges((changes) => {
      seen.push(...changes)
    })
    await expect(moveNoteIndexed('notes/a.md', 'notes/b.md', 4)).rejects.toBeDefined()
    unlisten()
    expect(seen).toEqual([])
  })
})
