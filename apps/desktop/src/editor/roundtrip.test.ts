import { describe, expect, it } from 'vitest'
import { canonicalizeImportBody, checkRoundTrip } from './roundtrip'

describe('checkRoundTrip', () => {
  it('classifies faithful content as exact', () => {
    const cases = [
      '# Heading\n\nA paragraph with [[Wiki Link]] and **bold**.\n',
      '> quote\n',
      '```\ncode [[not a link]]\n\nblank line inside fence\n```\n',
      '| a | b |\n| --- | --- |\n| 1 | 2 |\n',
      '- item one\n- item two\n',
      '- [ ] buy milk\n- [x] done\n',
      '<div>raw html</div>\n',
      'Title\n=====\n\nbody\n',
    ]
    for (const markdown of cases) {
      expect(checkRoundTrip(markdown), markdown).toBe('exact')
    }
  })

  it('classifies tightened loose lists as normalizing (content preserved)', () => {
    expect(checkRoundTrip('- item one\n\n- item two\n')).toBe('normalizing')
  })

  it('classifies git conflict markers as normalizing (protection comes from the marker gate)', () => {
    // meowdown grades conflict markers `normalizing`: `>>>>>>> other device`
    // re-serializes as `> > > > > > > other device`, which parses to the same
    // seven nested blockquotes, and `<<<<<<< ` / `=======` survive as a setext
    // heading. The bytes still change, and `>>>>>>> ` is the prefix conflict
    // resolution matches on, so protection for conflicted notes lives in the
    // note session's own `detectConflictMarkers` gate (see
    // `note-session-state.ts`), not in this classifier. This case is here to
    // notice if meowdown's verdict moves again.
    const conflicted = [
      '# Shared',
      '',
      '<<<<<<< this device',
      'edited on a',
      '=======',
      'edited on b',
      '>>>>>>> other device',
      '',
    ].join('\n')
    expect(checkRoundTrip(conflicted)).toBe('normalizing')
  })
})

describe('canonicalizeImportBody', () => {
  it('leaves an exact body alone', () => {
    expect(canonicalizeImportBody('Hello\n')).toEqual({ fidelity: 'exact', canonical: 'Hello\n' })
  })

  it('writes a normalizing body the way its first save would', () => {
    const body = '|a|b|\n|---|---|\n|1|2|\n'
    const result = canonicalizeImportBody(body)
    expect(result.fidelity).toBe('normalizing')
    expect(result.canonical).not.toBe(body)
    expect(checkRoundTrip(result.canonical)).toBe('exact')
  })

  it('keeps a body whose rewrite would move its structure', () => {
    // An indented sub-list under a numbered item loses its nesting when rewritten.
    const body = '  3. Compila:\n    - App name\n  4. Salva\n'
    expect(canonicalizeImportBody(body)).toEqual({ fidelity: 'lossy', canonical: body })
  })
})
