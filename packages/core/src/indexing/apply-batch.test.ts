import { afterEach, describe, expect, it, vi } from 'vitest'
import { setBridge } from '../ipc/bridge'
import {
  createIndexApplyBatch,
  INDEX_APPLY_BATCH_BYTES,
  INDEX_APPLY_BATCH_SIZE,
  indexedNoteWeight,
} from './apply-batch'
import type { IndexedNote } from './indexed-note'

afterEach(() => {
  setBridge(null)
})

/** A projection with `textLength` characters of body and nothing else. */
function note(path: string, textLength = 0): IndexedNote {
  return {
    path,
    id: null,
    title: path,
    titleKey: path,
    pathKey: path,
    kind: 'note',
    dailyDate: null,
    isPrivate: false,
    isPinned: false,
    pinnedOrder: null,
    hasConflict: false,
    gistUrl: null,
    gistStale: false,
    fileHash: 'hash',
    mtime: 0,
    text: 'x'.repeat(textLength),
    assetText: '',
    preview: '',
    links: [],
    tags: [],
    aliases: [],
    claims: [],
    emails: [],
    assets: [],
    tasks: [],
    properties: [],
    propertiesText: '',
    tagType: null,
  }
}

/** Collect the batches an apply run ships, newest last. */
function recordBatches(): { batches: IndexedNote[][]; invoke: ReturnType<typeof vi.fn> } {
  const batches: IndexedNote[][] = []
  const invoke = vi.fn(async (command: string, payload: unknown) => {
    if (command === 'index_apply_batch') {
      batches.push((payload as { notes: IndexedNote[] }).notes)
    }
    return null
  })
  setBridge({ invoke, listen: async () => () => {} })
  return { batches, invoke }
}

describe('indexedNoteWeight', () => {
  it('grows with the note it measures', () => {
    expect(indexedNoteWeight(note('a', 10_000))).toBeGreaterThan(
      indexedNoteWeight(note('a')) + 9_000,
    )
  })

  it('charges each projection row', () => {
    const withAssets: IndexedNote = { ...note('a'), assets: ['one.png', 'two.png'] }
    expect(indexedNoteWeight(withAssets)).toBeGreaterThan(indexedNoteWeight(note('a')))
  })
})

describe('createIndexApplyBatch', () => {
  it('flushes at the count cap for small notes', async () => {
    const { batches } = recordBatches()
    const batch = createIndexApplyBatch(1)
    for (let index = 0; index < INDEX_APPLY_BATCH_SIZE; index += 1) {
      await batch.add(note(`note-${index}.md`))
    }
    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(INDEX_APPLY_BATCH_SIZE)
    expect(batch.applied()).toBe(INDEX_APPLY_BATCH_SIZE)
  })

  it('flushes on the byte budget long before the count cap', async () => {
    const { batches } = recordBatches()
    const batch = createIndexApplyBatch(1)
    // Four notes are already past the budget: the fourth `add` ships them.
    const bigNote = Math.ceil(INDEX_APPLY_BATCH_BYTES / 3)
    for (let index = 0; index < 4; index += 1) {
      await batch.add(note(`big-${index}.md`, bigNote))
    }
    expect(batches).toHaveLength(1)
    expect(batches[0]!.length).toBeLessThan(INDEX_APPLY_BATCH_SIZE)
    await batch.flush()
    expect(batch.applied()).toBe(4)
  })

  it('applies a note larger than the whole budget on its own', async () => {
    const { batches } = recordBatches()
    const batch = createIndexApplyBatch(1)
    await batch.add(note('huge.md', INDEX_APPLY_BATCH_BYTES * 2))
    await batch.add(note('after.md'))
    await batch.flush()
    expect(batches.map((shipped) => shipped.map((entry) => entry.path))).toEqual([
      ['huge.md'],
      ['after.md'],
    ])
  })

  it('starts a fresh budget after every flush', async () => {
    const { batches } = recordBatches()
    const batch = createIndexApplyBatch(1)
    const half = Math.ceil(INDEX_APPLY_BATCH_BYTES / 2)
    await batch.add(note('a.md', half))
    await batch.flush()
    await batch.add(note('b.md', half))
    expect(batches).toHaveLength(1)
    await batch.flush()
    expect(batches).toHaveLength(2)
  })
})
