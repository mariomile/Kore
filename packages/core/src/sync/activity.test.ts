import { describe, expect, it } from 'vitest'
import { groupSittings, type ActivityCommit } from './activity'

const MINUTE = 60 * 1000

function commit(
  id: string,
  minutes: number,
  author: string,
  files: ActivityCommit['files'],
  agent?: string,
): ActivityCommit {
  return {
    commit: id,
    timeMs: minutes * MINUTE,
    authorName: author,
    authorEmail: '',
    summary: 'Update notes',
    trailers: agent === undefined ? [] : [{ key: 'Kore-Agent', value: agent }],
    files,
  }
}

describe('groupSittings', () => {
  it('groups one author’s close commits and names agents, the host and the owner', () => {
    const sittings = groupSittings([
      commit('e', 100, 'Mario', [{ path: 'notes/b.md', kind: 'modified' }]),
      commit('d', 90, 'Grok', [{ path: 'notes/a.md', kind: 'modified' }], 'Grok'),
      commit('c', 80, 'Grok', [{ path: 'notes/a.md', kind: 'added' }], 'Grok'),
      commit('b', 75, 'Kore host', [{ path: 'daily/x.md', kind: 'modified' }]),
      commit('a', 10, 'Kore host', [{ path: 'daily/x.md', kind: 'modified' }]),
    ])

    expect(sittings.map((sitting) => [sitting.author.kind, sitting.commits])).toEqual([
      ['owner', ['e']],
      ['agent', ['d', 'c']],
      ['host', ['b']],
      ['host', ['a']],
    ])
    const grok = sittings[1]!
    expect(grok.author).toEqual({ kind: 'agent', name: 'Grok' })
    expect(grok.notes).toEqual([{ path: 'notes/a.md', kind: 'added', commit: 'd' }])
    expect([grok.startMs, grok.endMs]).toEqual([80 * MINUTE, 90 * MINUTE])
  })

  it('leaves out the proposals Kore keeps in .kore/, never a note', () => {
    const sittings = groupSittings([
      commit('c', 30, 'Grok', [{ path: '.kore/proposals/1-a.json', kind: 'added' }], 'Grok'),
      commit(
        'b',
        20,
        'Grok',
        [
          { path: 'notes/a.md', kind: 'modified' },
          { path: '.kore/proposals/1-a.json', kind: 'deleted' },
        ],
        'Grok',
      ),
    ])
    expect(sittings.map((sitting) => sitting.commits)).toEqual([['b']])
    expect(sittings[0]?.notes.map((note) => note.path)).toEqual(['notes/a.md'])
  })
})
