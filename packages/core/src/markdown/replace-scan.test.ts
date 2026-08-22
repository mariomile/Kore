import { describe, expect, it } from 'vitest'
import {
  applyReplaceMatches,
  findReplaceMatches,
  foldPreservingLength,
  protectedRanges,
} from './replace-scan'

/**
 * Most of these are regressions against a specific way a whole-vault replace
 * corrupts a note. Each one was a concrete failure of the display-only
 * matching helpers this module deliberately does not reuse.
 */

function replaceAll(
  text: string,
  needle: string,
  replacement: string,
  options: { matchCase?: boolean; wholeWord?: boolean } = {},
): string {
  const matches = findReplaceMatches(text, {
    needle,
    matchCase: options.matchCase ?? true,
    wholeWord: options.wholeWord ?? false,
  })
  return applyReplaceMatches(text, matches, replacement)
}

function liveCount(text: string, needle: string, wholeWord = false): number {
  return findReplaceMatches(text, { needle, matchCase: true, wholeWord }).filter(
    (match) => match.skipped === null,
  ).length
}

describe('foldPreservingLength', () => {
  it('folds case without ever changing the string length', () => {
    expect(foldPreservingLength('ABC')).toBe('abc')
    expect(foldPreservingLength('Straße')).toHaveLength('Straße'.length)
  })

  it('leaves U+0130 raw, the one code point whose fold resizes it', () => {
    // `İ`.toLowerCase() is two units. Folding it would shift every later
    // offset by one and the write would eat a character.
    const text = 'İstanbul'
    expect(foldPreservingLength(text)).toHaveLength(text.length)
    expect(foldPreservingLength(text).startsWith('İ')).toBe(true)
  })
})

describe('findReplaceMatches — offsets', () => {
  it('writes at the right offsets after a length-changing code point', () => {
    const text = 'İstanbul trip\n\nThe cat sat here.\n'
    expect(replaceAll(text, 'cat', 'dog', { matchCase: false })).toBe(
      'İstanbul trip\n\nThe dog sat here.\n',
    )
  })

  it('replaces every occurrence, not just the first', () => {
    expect(replaceAll('cat cat cat', 'cat', 'dog')).toBe('dog dog dog')
  })

  it('never overlaps matches', () => {
    expect(replaceAll('aaaa', 'aa', 'b')).toBe('bb')
  })

  it('treats the replacement as literal text', () => {
    // No pattern means nothing for `$&` to refer back to.
    expect(replaceAll('cat', 'cat', String.raw`$& $1 \n`)).toBe(String.raw`$& $1 \n`)
  })

  it('finds nothing for an empty needle', () => {
    expect(
      findReplaceMatches('anything', { needle: '', matchCase: true, wholeWord: false }),
    ).toEqual([])
  })
})

describe('findReplaceMatches — word boundaries', () => {
  it('does not fire inside a longer word', () => {
    expect(replaceAll('category', 'cat', 'dog', { wholeWord: true })).toBe('category')
    expect(replaceAll('the cat', 'cat', 'dog', { wholeWord: true })).toBe('the dog')
  })

  it('treats _ as a word character', () => {
    // Whole-word is sold as the guard against wrecking identifiers; it has to
    // stop snake_case too, not just letters.
    expect(replaceAll('cat_food_2026', 'cat', 'dog', { wholeWord: true })).toBe('cat_food_2026')
    expect(replaceAll('my_cat_here', 'cat', 'dog', { wholeWord: true })).toBe('my_cat_here')
  })

  it('treats a combining mark as continuing a word', () => {
    // NFD café is `cafe` + U+0301; without \p{M} the `cafe` inside it reads
    // as a whole word and the replace splits the grapheme.
    const decomposed = 'café open'
    expect(replaceAll(decomposed, 'cafe', 'bar', { wholeWord: true })).toBe(decomposed)
  })

  it('probes code points, not code units, at the edges', () => {
    // U+1D5D6 is an astral letter; read as a lone surrogate it is not \p{L}
    // and the boundary test wrongly passes.
    expect(replaceAll('\u{1D5D6}at', 'at', 'og', { wholeWord: true })).toBe('\u{1D5D6}at')
    expect(replaceAll('at\u{1D7ED}', 'at', 'og', { wholeWord: true })).toBe('at\u{1D7ED}')
  })

  it('matches at the very start and end of the text', () => {
    expect(replaceAll('cat', 'cat', 'dog', { wholeWord: true })).toBe('dog')
  })
})

describe('protected ranges — frontmatter', () => {
  it('never rewrites YAML', () => {
    const text = '---\ntitle: cat\n---\n\nThe cat sat.\n'
    expect(replaceAll(text, 'cat', 'dog')).toBe('---\ntitle: cat\n---\n\nThe dog sat.\n')
  })

  it('is not defeated by a leading byte-order mark', () => {
    const text = '﻿---\ntitle: cat\n---\n\nThe cat sat.\n'
    expect(replaceAll(text, 'cat', 'dog')).toBe('﻿---\ntitle: cat\n---\n\nThe dog sat.\n')
  })
})

describe('protected ranges — code', () => {
  it('skips fenced code', () => {
    const text = 'Prose cat.\n\n```\nconst cat = 1\n```\n'
    expect(replaceAll(text, 'cat', 'dog')).toBe('Prose dog.\n\n```\nconst cat = 1\n```\n')
  })

  it('pairs fences by run length, so a longer fence wraps a shorter one', () => {
    // Closing on the first inner ``` leaves the rest of the block exposed.
    const text = '````\n```\ncat\n```\n````\n\nProse cat.\n'
    expect(replaceAll(text, 'cat', 'dog')).toBe('````\n```\ncat\n```\n````\n\nProse dog.\n')
  })

  it('does not close a backtick fence with a tilde fence', () => {
    const text = '```\ncat\n~~~\ncat\n```\n'
    expect(replaceAll(text, 'cat', 'dog')).toBe(text)
  })

  it('protects an unclosed fence to the end of the note', () => {
    expect(replaceAll('```\ncat\ncat\n', 'cat', 'dog')).toBe('```\ncat\ncat\n')
  })

  it('pairs inline code by backtick-run length', () => {
    expect(replaceAll('a `cat` b', 'cat', 'dog')).toBe('a `cat` b')
    // A doubled run closes only on a doubled run, so the inner tick is code.
    expect(replaceAll('``a ` cat`` and cat', 'cat', 'dog')).toBe('``a ` cat`` and dog')
  })

  it('leaves a stray backtick protecting nothing rather than the wrong thing', () => {
    // Greedy pairing would protect the gap and expose the real span.
    expect(liveCount('` cat and `cat`', 'cat')).toBeGreaterThan(0)
  })
})

describe('protected ranges — links', () => {
  it('skips markdown link destinations but not their labels', () => {
    const text = '[the cat](https://x.test/cat)\n'
    expect(replaceAll(text, 'cat', 'dog')).toBe('[the dog](https://x.test/cat)\n')
  })

  it('handles one level of nested parens in a destination', () => {
    const text = '[a](https://x.test/cat_(page))\n\nProse cat.\n'
    expect(replaceAll(text, 'cat', 'dog')).toBe('[a](https://x.test/cat_(page))\n\nProse dog.\n')
  })

  it('skips autolinks, bare URLs and reference definitions', () => {
    expect(replaceAll('<https://x.test/cat>', 'cat', 'dog')).toBe('<https://x.test/cat>')
    expect(replaceAll('see https://x.test/cat now', 'cat', 'dog')).toBe(
      'see https://x.test/cat now',
    )
    expect(replaceAll('[ref]: https://x.test/cat\n', 'cat', 'dog')).toBe(
      '[ref]: https://x.test/cat\n',
    )
  })

  it('never rewrites a wiki-link target', () => {
    // The target is an address; rewriting it breaks the link silently.
    expect(replaceAll('See [[cat notes]] and cat.', 'cat', 'dog')).toBe(
      'See [[cat notes]] and dog.',
    )
  })
})

describe('protected ranges — the note title', () => {
  it('never rewrites the H1, which would rename the note', () => {
    // A rename orphans every inbound wiki link. Renaming has its own flow.
    const text = '# The cat note\n\nThe cat sat.\n'
    expect(replaceAll(text, 'cat', 'dog')).toBe('# The cat note\n\nThe dog sat.\n')
  })

  it('reports a title match as skipped rather than dropping it', () => {
    const matches = findReplaceMatches('# The cat note\n\ncat\n', {
      needle: 'cat',
      matchCase: true,
      wholeWord: false,
    })
    expect(matches).toHaveLength(2)
    expect(matches[0]?.skipped).toBe('title')
    expect(matches[1]?.skipped).toBeNull()
  })

  it('only protects the first heading, not every h1-looking line', () => {
    const text = '# Title\n\ncat\n\n# Later cat\n'
    expect(replaceAll(text, 'cat', 'dog')).toBe('# Title\n\ndog\n\n# Later dog\n')
  })

  it('does not mistake a fenced comment for the title', () => {
    const text = '```\n# cat\n```\n\n# The cat note\n\ncat\n'
    expect(replaceAll(text, 'cat', 'dog')).toBe('```\n# cat\n```\n\n# The cat note\n\ndog\n')
  })
})

describe('protectedRanges', () => {
  it('returns the regions sorted by start offset', () => {
    const ranges = protectedRanges('---\na: 1\n---\n# T\n\n`x`\n\n[a](b)\n')
    expect(ranges.length).toBeGreaterThan(1)
    expect([...ranges].sort((a, b) => a.from - b.from)).toEqual(ranges)
  })
})

describe('line endings', () => {
  it('leaves CRLF documents byte-identical apart from the replacement', () => {
    const text = '---\r\ntitle: A\r\n---\r\n\r\nThe cat sat.\r\n'
    expect(replaceAll(text, 'cat', 'dog')).toBe('---\r\ntitle: A\r\n---\r\n\r\nThe dog sat.\r\n')
  })
})
