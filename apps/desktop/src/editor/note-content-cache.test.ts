import { describe, expect, it } from 'vitest'
import {
  cacheNoteContent,
  enableNoteContentCache,
  getCachedNoteContent,
  invalidateCachedNote,
} from './note-content-cache'

describe('note-content-cache', () => {
  it('misses (and stores nothing) while no lifecycle is mounted', () => {
    cacheNoteContent('notes/a.md', '# A\n')
    expect(getCachedNoteContent('notes/a.md')).toBeUndefined()

    const disable = enableNoteContentCache()
    // Nothing was stored while off — and content cached while on serves.
    expect(getCachedNoteContent('notes/a.md')).toBeUndefined()
    cacheNoteContent('notes/a.md', '# A\n')
    expect(getCachedNoteContent('notes/a.md')).toBe('# A\n')
    disable()
    expect(getCachedNoteContent('notes/a.md')).toBeUndefined()
  })

  it('the last disable clears entries, so nothing survives a graph switch', () => {
    const disable = enableNoteContentCache()
    cacheNoteContent('notes/a.md', '# A\n')
    disable()
    disable() // idempotent — a double-invoked effect cleanup must not underflow

    const again = enableNoteContentCache()
    expect(getCachedNoteContent('notes/a.md')).toBeUndefined()
    again()
  })

  it('invalidates single paths and evicts oldest-first past the cap', () => {
    const disable = enableNoteContentCache()
    try {
      cacheNoteContent('notes/a.md', '# A\n')
      invalidateCachedNote('notes/a.md')
      expect(getCachedNoteContent('notes/a.md')).toBeUndefined()

      for (let index = 0; index < 64; index += 1) {
        cacheNoteContent(`notes/filler-${index}.md`, '# filler\n')
      }
      cacheNoteContent('notes/last.md', '# last\n')
      // The cap dropped the oldest filler; the newest entries remain.
      expect(getCachedNoteContent('notes/filler-0.md')).toBeUndefined()
      expect(getCachedNoteContent('notes/filler-63.md')).toBe('# filler\n')
      expect(getCachedNoteContent('notes/last.md')).toBe('# last\n')
    } finally {
      disable()
    }
  })

  it('a read refreshes recency, and oversized content is never cached', () => {
    const disable = enableNoteContentCache()
    try {
      cacheNoteContent('notes/keep.md', '# keep\n')
      for (let index = 0; index < 63; index += 1) {
        cacheNoteContent(`notes/filler-${index}.md`, '# filler\n')
      }
      // Touch the oldest entry, then push one past the cap: the untouched
      // filler is evicted instead.
      expect(getCachedNoteContent('notes/keep.md')).toBe('# keep\n')
      cacheNoteContent('notes/overflow.md', '# overflow\n')
      expect(getCachedNoteContent('notes/keep.md')).toBe('# keep\n')
      expect(getCachedNoteContent('notes/filler-0.md')).toBeUndefined()

      cacheNoteContent('notes/huge.md', '#'.repeat(513 * 1024))
      expect(getCachedNoteContent('notes/huge.md')).toBeUndefined()
    } finally {
      disable()
    }
  })
})
