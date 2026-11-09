import { afterEach, describe, expect, it, vi } from 'vitest'
import { subscribeOwnWrites } from '../indexing/local-write-echo'
import { setBridge } from '../ipc/bridge'
import { createNoteIfAbsent, openAsset } from './commands'

afterEach(() => {
  setBridge(null)
})

describe('graph commands', () => {
  it('creates a note through the generation-pinned no-clobber boundary', async () => {
    const invoke = vi.fn(async () => ({ kind: 'created', modifiedMs: 1_234 }))
    setBridge({ invoke, listen: async () => () => {} })
    const ownWrites: string[] = []
    const unlisten = subscribeOwnWrites((path) => {
      ownWrites.push(path)
    })

    try {
      await expect(
        createNoteIfAbsent('notes/business-ideas.md', '# Business ideas\n', 7),
      ).resolves.toEqual({ kind: 'created', modifiedMs: 1_234 })
      expect(invoke).toHaveBeenCalledWith('note_create', {
        path: 'notes/business-ideas.md',
        contents: '# Business ideas\n',
        generation: 7,
      })
      expect(ownWrites).toEqual(['notes/business-ideas.md'])
    } finally {
      unlisten()
    }
  })

  it('propagates a note-create rejection without echoing a local write', async () => {
    // The failure side of the generation pin: a stale-generation bridge
    // rejection reaches the caller, and nothing pretends a file was written.
    const invoke = vi.fn(async () => {
      throw { kind: 'io', message: 'the graph changed since this command was issued; dropping it' }
    })
    setBridge({ invoke, listen: async () => () => {} })
    const ownWrites: string[] = []
    const unlisten = subscribeOwnWrites((path) => {
      ownWrites.push(path)
    })

    try {
      await expect(
        createNoteIfAbsent('notes/business-ideas.md', '# Business ideas\n', 6),
      ).rejects.toMatchObject({ kind: 'io' })
      expect(ownWrites).toEqual([])
    } finally {
      unlisten()
    }
  })

  it('returns a note-create collision without echoing a local write', async () => {
    const invoke = vi.fn(async () => ({ kind: 'collision' }))
    setBridge({ invoke, listen: async () => () => {} })
    const ownWrites: string[] = []
    const unlisten = subscribeOwnWrites((path) => {
      ownWrites.push(path)
    })

    try {
      await expect(
        createNoteIfAbsent('notes/business-ideas.md', '# Replacement\n', 7),
      ).resolves.toEqual({ kind: 'collision' })
      expect(ownWrites).toEqual([])
    } finally {
      unlisten()
    }
  })

  it('opens assets through the generation-pinned native command', async () => {
    const invoke = vi.fn(async () => null)
    setBridge({ invoke, listen: async () => () => {} })

    await openAsset('assets/cat.png', 7)

    expect(invoke).toHaveBeenCalledWith('asset_open', {
      path: 'assets/cat.png',
      generation: 7,
    })
  })
})
