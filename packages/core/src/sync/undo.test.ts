import { afterEach, describe, expect, it } from 'vitest'
import { setBridge } from '../ipc/bridge'
import type { ActivitySitting } from './activity'
import { undoSitting, type UndoPreview } from './undo'

afterEach(() => {
  setBridge(null)
})

const COMMITTED = { committed: true, sha: 'abc', ahead: 1, skippedLargeFiles: [] }

const SITTING: ActivitySitting = {
  id: 'c2',
  author: { kind: 'agent', name: 'Grok' },
  startMs: 1,
  endMs: 2,
  commits: ['c2', 'c1'],
  notes: [],
}

function fakeBridge(preview: UndoPreview) {
  const calls: { command: string; args: Record<string, unknown> }[] = []
  setBridge({
    invoke: async (command, args) => {
      calls.push({ command, args })
      switch (command) {
        case 'git_undo_preview':
          return preview
        case 'git_commit_all':
          return COMMITTED
        case 'note_write':
          return 1
        default:
          return null
      }
    },
    listen: async () => () => {},
  })
  return calls
}

describe('undoSitting', () => {
  it('snapshots, writes back each note, removes created ones, then commits', async () => {
    const calls = fakeBridge({
      files: [
        { path: 'notes/a.md', content: 'before\n' },
        { path: 'notes/new.md', content: null },
        { path: 'daily/2026-11-08.md', content: null },
      ],
      conflicts: [],
    })
    const removed: string[] = []

    const result = await undoSitting(SITTING, 4, {
      remove: async (path) => {
        removed.push(path)
      },
    })

    expect(result).toEqual({
      kind: 'undone',
      notes: ['notes/a.md', 'notes/new.md', 'daily/2026-11-08.md'],
    })
    expect(calls.map((call) => call.command)).toEqual([
      'git_commit_all',
      'git_undo_preview',
      'note_write',
      'note_write',
      'git_commit_all',
    ])
    expect(calls[1]!.args).toMatchObject({ newest: 'c2', oldest: 'c1', generation: 4 })
    expect(calls[3]!.args).toMatchObject({ path: 'daily/2026-11-08.md', contents: '' })
    expect(removed).toEqual(['notes/new.md'])
  })

  it('writes nothing when any note conflicts', async () => {
    const calls = fakeBridge({
      files: [
        { path: 'notes/a.md', content: 'before\n' },
        { path: 'assets/pic.png', content: null },
      ],
      conflicts: [{ path: 'notes/b.md', reason: 'changedSince' }],
    })

    const result = await undoSitting(SITTING, 4)

    expect(result).toEqual({
      kind: 'conflict',
      conflicts: [
        { path: 'notes/b.md', reason: 'changedSince' },
        { path: 'assets/pic.png', reason: 'notANote' },
      ],
    })
    expect(calls.map((call) => call.command)).toEqual(['git_commit_all', 'git_undo_preview'])
  })
})
