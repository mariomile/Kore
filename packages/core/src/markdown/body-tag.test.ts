import { describe, expect, it } from 'vitest'
import { parseNote } from './extract'
import { appendBodyTag, bodyHasTag, removeBodyTag } from './body-tag'

describe('bodyHasTag', () => {
  it('matches the tag the index would extract, folded', () => {
    expect(bodyHasTag('Reading #Book tonight', 'book')).toBe(true)
    expect(bodyHasTag('Reading #book tonight', 'BOOK')).toBe(true)
    expect(bodyHasTag('Reading #books tonight', 'book')).toBe(false)
  })

  it('does not match a hash that is not a tag', () => {
    expect(bodyHasTag('see https://x.test/a#book', 'book')).toBe(false)
    expect(bodyHasTag('a#book', 'book')).toBe(false)
  })
})

describe('appendBodyTag', () => {
  it('appends the tag on its own trailing line', () => {
    expect(appendBodyTag('Some prose.\n', 'book')).toBe('Some prose.\n\n#book\n')
  })

  it('returns null when the note already carries the tag', () => {
    // Null rather than the unchanged string: the caller must be able to tell
    // "nothing to do" from "here is a write" without comparing.
    expect(appendBodyTag('Reading #book tonight\n', 'book')).toBeNull()
    expect(appendBodyTag('Reading #Book tonight\n', 'book')).toBeNull()
  })

  it('preserves frontmatter and tags only the body', () => {
    const source = '---\ntitle: A\nid: xyz\n---\nSome prose.\n'
    expect(appendBodyTag(source, 'book')).toBe(
      '---\ntitle: A\nid: xyz\n---\nSome prose.\n\n#book\n',
    )
  })

  it('does not open an empty note with a blank line', () => {
    expect(appendBodyTag('', 'book')).toBe('#book\n')
    expect(appendBodyTag('\n\n  \n', 'book')).toBe('#book\n')
  })

  it('collapses a trailing blank run instead of stacking on it', () => {
    expect(appendBodyTag('Some prose.\n\n\n\n', 'book')).toBe('Some prose.\n\n#book\n')
  })

  it('is idempotent through a second pass', () => {
    const once = appendBodyTag('Some prose.\n', 'book')
    expect(once).not.toBeNull()
    expect(appendBodyTag(once as string, 'book')).toBeNull()
  })

  it('produces a tag the extractor actually indexes', () => {
    // The whole point: the appended text has to survive the same scan the
    // index runs, or the note is edited and still untagged.
    const source = appendBodyTag('---\ntitle: A\n---\nSome prose.\n', 'reading/queue')
    expect(source).not.toBeNull()
    expect(parseNote({ path: 'notes/a.md', source: source as string }).tags).toContain(
      'reading/queue',
    )
  })
})

describe('removeBodyTag', () => {
  it('returns null when the note does not carry the tag', () => {
    expect(removeBodyTag('Some prose.\n', 'book')).toBeNull()
  })

  it('removes a trailing membership line and leaves the prose', () => {
    expect(removeBodyTag('Some prose.\n\n#book\n', 'book')).toBe('Some prose.\n')
  })

  it('removes a leading membership line', () => {
    expect(removeBodyTag('#project\n\nThe pitch.\n', 'project')).toBe('The pitch.\n')
  })

  it('removes an inline mention without leaving a doubled space', () => {
    expect(removeBodyTag('Reading #book tonight\n', 'book')).toBe('Reading tonight\n')
  })

  it('clears every occurrence so the note leaves the collection', () => {
    expect(removeBodyTag('#book\n\nSee also #Book later.\n', 'book')).toBe('See also later.\n')
  })

  it('preserves frontmatter and only edits the body', () => {
    expect(removeBodyTag('---\ntitle: A\nid: xyz\n---\nSome prose.\n\n#book\n', 'book')).toBe(
      '---\ntitle: A\nid: xyz\n---\nSome prose.\n',
    )
  })

  it('leaves a sibling tag on the same membership line', () => {
    expect(removeBodyTag('#project #person\n', 'project')).toBe('#person\n')
  })

  it('is the inverse of appendBodyTag on a trailing line', () => {
    const tagged = appendBodyTag('Some prose.\n', 'book')
    expect(tagged).not.toBeNull()
    expect(removeBodyTag(tagged as string, 'book')).toBe('Some prose.\n')
  })
})
