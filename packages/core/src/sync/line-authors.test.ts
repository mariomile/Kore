import { afterEach, describe, expect, it, vi } from 'vitest'
import { setBridge } from '../ipc/bridge'
import { gitBlame, lineAuthorKey, lineAuthors, type NoteBlame } from './line-authors'

afterEach(() => {
  setBridge(null)
})

const blame: NoteBlame = {
  hunks: [
    { startLine: 1, lines: 2, commit: 'aaa' },
    { startLine: 3, lines: 1, commit: 'bbb' },
    { startLine: 4, lines: 1, commit: 'ccc' },
    { startLine: 5, lines: 1, commit: null },
  ],
  commits: {
    aaa: { timeMs: 1, authorName: 'Mario', authorEmail: 'm@example.com', trailers: [] },
    bbb: {
      timeMs: 2,
      authorName: 'Grok',
      authorEmail: 'grok@agents.kore',
      trailers: [{ key: 'Kore-Agent', value: 'Grok' }],
    },
    ccc: { timeMs: 3, authorName: 'Kore host', authorEmail: 'host@kore', trailers: [] },
  },
}

describe('lineAuthors', () => {
  it('names each line: the owner, an agent by its trailer, the host, or not saved yet', () => {
    const authors = lineAuthors(blame, 6)
    expect(authors.map(lineAuthorKey)).toEqual([
      'owner',
      'owner',
      'agent:grok',
      'host',
      'unsaved',
      'unsaved',
    ])
    expect(authors[2]).toEqual({ kind: 'agent', name: 'Grok', timeMs: 2 })
  })

  it('ignores hunks past the shown text and commits the blame did not describe', () => {
    const authors = lineAuthors(
      {
        hunks: [...blame.hunks, { startLine: 9, lines: 3, commit: 'zzz' }],
        commits: blame.commits,
      },
      2,
    )
    expect(authors.map(lineAuthorKey)).toEqual(['owner', 'owner'])
  })
})

describe('gitBlame', () => {
  it('blames the shown text through the native command and validates the answer', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(blame)
    setBridge({ invoke, listen: async () => () => {} })
    await expect(gitBlame('notes/a.md', 'one\n', 4)).resolves.toEqual(blame)
    expect(invoke).toHaveBeenCalledWith('git_blame', {
      path: 'notes/a.md',
      content: 'one\n',
      generation: 4,
    })
    invoke.mockResolvedValueOnce({ hunks: [{ startLine: 0, lines: 1, commit: null }], commits: {} })
    await expect(gitBlame('notes/a.md', 'one\n', 4)).rejects.toThrow()
  })
})
