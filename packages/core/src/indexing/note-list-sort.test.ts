import { describe, expect, it } from 'vitest'
import { ALL_NOTES_SORTS } from '../settings/schema-collections'
import { allNotesSortFrom, allNotesSortParts, sortNoteList } from './note-list-sort'
import type { ClassifiedNoteListEntry } from './note-list'

function note(overrides: Partial<ClassifiedNoteListEntry>): ClassifiedNoteListEntry {
  return {
    path: overrides.path ?? 'notes/note.md',
    title: overrides.title ?? 'Note',
    snippet: '',
    tags: [],
    mtime: overrides.mtime ?? 0,
    isPinned: overrides.isPinned ?? false,
    isInbox: overrides.isInbox ?? false,
  }
}

describe('sortNoteList', () => {
  const banana = note({ path: 'notes/b.md', title: 'Banana', mtime: 200 })
  const apple = note({ path: 'notes/a.md', title: 'apple', mtime: 300 })
  const cherry = note({ path: 'notes/c.md', title: 'Cherry', mtime: 100 })
  const pinned = note({
    path: 'notes/p.md',
    title: 'Zebra',
    mtime: 50,
    isPinned: true,
  })

  it('keeps pinned notes first, in their existing order, regardless of sort', () => {
    const result = sortNoteList([banana, pinned, apple], 'title-asc')
    expect(result[0]).toBe(pinned)
    expect(result.map((n) => n.path)).toEqual(['notes/p.md', 'notes/a.md', 'notes/b.md'])
  })

  it('orders the unpinned tail by most recently updated', () => {
    expect(sortNoteList([banana, apple, cherry], 'updated-desc').map((n) => n.path)).toEqual([
      'notes/a.md',
      'notes/b.md',
      'notes/c.md',
    ])
  })

  it('orders the unpinned tail by least recently updated', () => {
    expect(sortNoteList([banana, apple, cherry], 'updated-asc').map((n) => n.path)).toEqual([
      'notes/c.md',
      'notes/b.md',
      'notes/a.md',
    ])
  })

  it('orders the unpinned tail by title A to Z, case-insensitively', () => {
    expect(sortNoteList([banana, apple, cherry], 'title-asc').map((n) => n.path)).toEqual([
      'notes/a.md',
      'notes/b.md',
      'notes/c.md',
    ])
  })

  it('orders the unpinned tail by title Z to A', () => {
    expect(sortNoteList([banana, apple, cherry], 'title-desc').map((n) => n.path)).toEqual([
      'notes/c.md',
      'notes/b.md',
      'notes/a.md',
    ])
  })

  it('breaks ties by path', () => {
    const tiedA = note({ path: 'notes/x.md', title: 'Same', mtime: 100 })
    const tiedB = note({ path: 'notes/y.md', title: 'Same', mtime: 100 })
    expect(sortNoteList([tiedB, tiedA], 'title-asc').map((n) => n.path)).toEqual([
      'notes/x.md',
      'notes/y.md',
    ])
    expect(sortNoteList([tiedB, tiedA], 'updated-desc').map((n) => n.path)).toEqual([
      'notes/x.md',
      'notes/y.md',
    ])
  })

  it('orders numbered titles naturally and folds accents', () => {
    const ten = note({ path: 'notes/10.md', title: 'Note 10' })
    const two = note({ path: 'notes/2.md', title: 'Note 2' })
    const ecole = note({ path: 'notes/e.md', title: 'École' })
    const fig = note({ path: 'notes/f.md', title: 'fig' })
    expect(sortNoteList([fig, ten, ecole, two], 'title-asc').map((n) => n.title)).toEqual([
      'École',
      'fig',
      'Note 2',
      'Note 10',
    ])
  })

  it('sorts any row shape carrying path, title, mtime and pin state', () => {
    const rows = [
      { path: 'b.md', title: 'B', mtime: 1, isPinned: false, extra: 1 },
      { path: 'a.md', title: 'A', mtime: 2, isPinned: false, extra: 2 },
    ]
    expect(sortNoteList(rows, 'title-asc').map((row) => row.extra)).toEqual([2, 1])
  })
})

describe('allNotesSortParts / allNotesSortFrom', () => {
  it('round-trips every persisted sort through its field and direction', () => {
    for (const sort of ALL_NOTES_SORTS) {
      const { field, direction } = allNotesSortParts(sort)
      expect(allNotesSortFrom(field, direction)).toBe(sort)
    }
    expect(allNotesSortParts('title-desc')).toEqual({
      field: 'title',
      direction: 'desc',
    })
  })
})
