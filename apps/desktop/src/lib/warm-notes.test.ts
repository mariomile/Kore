import { describe, expect, it } from 'vitest'
import { nextWarmNotes, WARM_NOTE_LIMIT, type WarmNote } from './warm-notes'

const open = (...paths: string[]) => new Set(paths)

describe('nextWarmNotes', () => {
  it('adds the note on screen', () => {
    expect(nextWarmNotes([], 'a.md', open())).toEqual([{ path: 'a.md', shownAt: 1 }])
  })

  it('returns the same list when nothing changes, so render settles', () => {
    const warm: WarmNote[] = [{ path: 'a.md', shownAt: 1 }]
    expect(nextWarmNotes(warm, 'a.md', open('a.md'))).toBe(warm)
    expect(nextWarmNotes(warm, null, open('a.md'))).toBe(warm)
  })

  it('keeps mount order when a warm note comes back on screen', () => {
    const warm: WarmNote[] = [
      { path: 'a.md', shownAt: 1 },
      { path: 'b.md', shownAt: 2 },
    ]
    expect(nextWarmNotes(warm, 'a.md', open('a.md', 'b.md'))).toEqual([
      { path: 'a.md', shownAt: 3 },
      { path: 'b.md', shownAt: 2 },
    ])
  })

  it('drops a note whose tab closed, unless it is on screen', () => {
    const warm: WarmNote[] = [
      { path: 'a.md', shownAt: 1 },
      { path: 'b.md', shownAt: 2 },
    ]
    expect(nextWarmNotes(warm, 'b.md', open())).toEqual([{ path: 'b.md', shownAt: 2 }])
    expect(nextWarmNotes(warm, null, open('a.md'))).toEqual([{ path: 'a.md', shownAt: 1 }])
  })

  it('evicts the least recently shown note past the limit', () => {
    const paths = Array.from({ length: WARM_NOTE_LIMIT + 1 }, (_, i) => `${i}.md`)
    let warm: readonly WarmNote[] = []
    for (const path of paths) {
      warm = nextWarmNotes(warm, path, open(...paths))
    }
    expect(warm.map((note) => note.path)).toEqual(paths.slice(1))
  })
})
