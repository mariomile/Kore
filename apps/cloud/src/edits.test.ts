import { describe, expect, it } from 'vitest'
import { appendBlock, isTagName, newNoteSource, patchProperties, replacePassage } from './edits'

describe('appendBlock', () => {
  it('appends after one blank line, like the CLI', () => {
    expect(appendBlock('# T\nbody\n', '## More\n\ntext\n')).toBe('# T\nbody\n\n## More\n\ntext\n')
    expect(appendBlock('', 'first')).toBe('first\n')
    expect(appendBlock('# T\r\nbody\r\n', 'a\nb')).toBe('# T\r\nbody\r\n\r\na\r\nb\r\n')
  })
})

describe('replacePassage', () => {
  it('replaces the one occurrence in the body and never touches frontmatter', () => {
    const source = '---\nstatus: draft\n---\n# T\n\nstatus: draft here\n'
    expect(replacePassage(source, 'status: draft here', 'done')).toEqual({
      source: '---\nstatus: draft\n---\n# T\n\ndone\n',
    })
  })

  it('refuses a missing or repeated passage', () => {
    expect(replacePassage('# T\n\nx x\n', 'y', 'z')).toEqual({ refused: 'missing' })
    expect(replacePassage('# T\n\nx x\n', 'x', 'z')).toEqual({ refused: 'ambiguous' })
  })
})

describe('newNoteSource', () => {
  it('writes the H1, the body, a tag line and frontmatter', () => {
    const source = newNoteSource('Pricing', 'Seats.', ['strategy'], { status: 'draft' })
    expect(source).toBe('---\nstatus: draft\n---\n# Pricing\n\nSeats.\n\n#strategy\n')
  })

  it('keeps a body that brings its own H1', () => {
    expect(newNoteSource('X', '# Own title\n\nbody', [], {})).toBe('# Own title\n\nbody\n')
  })
})

describe('patchProperties', () => {
  it('sets and removes keys', () => {
    expect(patchProperties('---\na: 1\nb: 2\n---\n# T\n', { c: 3 }, ['a'])).toBe(
      '---\nb: 2\nc: 3\n---\n# T\n',
    )
  })
})

describe('isTagName', () => {
  it('matches the CLI rule', () => {
    expect(isTagName('type/person')).toBe(true)
    expect(isTagName('2026')).toBe(false)
    expect(isTagName('a b')).toBe(false)
  })
})
