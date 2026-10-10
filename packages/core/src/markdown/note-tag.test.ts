import { describe, expect, it } from 'vitest'
import { addNoteTag, noteHasTag, removeNoteTag } from './note-tag'

describe('addNoteTag', () => {
  it('grows an existing tags list in place and leaves the body alone', () => {
    const source = '---\ntitle: Dune\ntags:\n  - type/book # read 2024\n---\nBody\n'
    expect(addNoteTag(source, 'book')).toBe(
      '---\ntitle: Dune\ntags:\n  - type/book # read 2024\n  - book\n---\nBody\n',
    )
  })

  it('opens a frontmatter block on a note without one, and is a no-op when either source has the tag', () => {
    expect(addNoteTag('# Dune\n', 'book')).toBe('---\ntags:\n  - book\n---\n# Dune\n')
    expect(addNoteTag('---\ntags: [Book]\n---\n', 'book')).toBeNull()
    expect(addNoteTag('Reading #book\n', 'book')).toBeNull()
  })

  it('falls back to a body tag when tags holds something it cannot extend', () => {
    expect(addNoteTag('---\ntags: {a: 1}\n---\nBody\n', 'book')).toBe(
      '---\ntags: {a: 1}\n---\nBody\n\n#book\n',
    )
  })
})

describe('removeNoteTag', () => {
  it('clears the tag from both sources, dropping an emptied key and block', () => {
    const source = '---\ntags: [book]\n---\nReading #book tonight\n'
    const next = removeNoteTag(source, 'Book')
    expect(next).toBe('Reading tonight\n')
    expect(noteHasTag(next ?? '', 'book')).toBe(false)
  })

  it('keeps the other tags and keys, and returns null when the tag is absent', () => {
    const source = '---\ntitle: Dune\ntags:\n  - "#book"\n  - type/novel\n---\nBody\n'
    expect(removeNoteTag(source, 'book')).toBe(
      '---\ntitle: Dune\ntags:\n  - type/novel\n---\nBody\n',
    )
    expect(removeNoteTag(source, 'film')).toBeNull()
  })
})
