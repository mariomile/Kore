import { describe, expect, it } from 'vitest'
import { diffLines } from './line-diff'

describe('diffLines', () => {
  it('marks an inserted and a removed line around unchanged context', () => {
    expect(diffLines('a\nb\nc\n', 'a\nx\nc\n')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'x' },
      { kind: 'same', text: 'c' },
    ])
  })

  it('treats identical content (and trailing-newline drift) as all-same', () => {
    expect(diffLines('a\nb\n', 'a\nb')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'same', text: 'b' },
    ])
  })

  it('diffs from empty (a first version) as all-added', () => {
    expect(diffLines('', '# Title\nbody\n')).toEqual([
      { kind: 'added', text: '# Title' },
      { kind: 'added', text: 'body' },
    ])
  })

  it('keeps a moved block coherent through the LCS', () => {
    const result = diffLines('one\ntwo\nthree\n', 'two\nthree\nfour\n')
    expect(result).toEqual([
      { kind: 'removed', text: 'one' },
      { kind: 'same', text: 'two' },
      { kind: 'same', text: 'three' },
      { kind: 'added', text: 'four' },
    ])
  })
})
