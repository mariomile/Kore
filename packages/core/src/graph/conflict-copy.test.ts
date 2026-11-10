import { afterEach, describe, expect, it, vi } from 'vitest'
import { setBridge } from '../ipc/bridge'
import { conflictCopyPath, saveConflictCopy } from './conflict-copy'

afterEach(() => {
  setBridge(null)
})

describe('conflict copies', () => {
  it('names the copy beside the note, like the git sync does', () => {
    expect(conflictCopyPath('notes/Idea.md')).toBe('notes/Idea (conflict).md')
    expect(conflictCopyPath('daily/2026-11-10.md', 2)).toBe('daily/2026-11-10 (conflict 2).md')
    expect(conflictCopyPath('v1.0/note')).toBe('v1.0/note (conflict)')
  })

  it('takes the next free name instead of overwriting an earlier copy', async () => {
    const invoke = vi.fn(async (_command: string, args?: Record<string, unknown>) =>
      args?.['path'] === 'notes/Idea (conflict).md'
        ? { kind: 'collision' }
        : { kind: 'created', modifiedMs: 1 },
    )
    setBridge({ invoke, listen: async () => () => {} })

    await expect(saveConflictCopy('notes/Idea.md', 'mine\n', 3)).resolves.toBe(
      'notes/Idea (conflict 2).md',
    )
  })
})
