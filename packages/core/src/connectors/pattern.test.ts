import { describe, expect, it } from 'vitest'
import { normalizeConnectorPattern, parseConnectorTags, renderNotePlacement } from './pattern'
import { readwiseConnector } from './readwise'

describe('renderNotePlacement', () => {
  it('splits subfolders, fills fields and keeps values inside their segment', () => {
    expect(
      renderNotePlacement(
        '{category}/{title}, {author}',
        { title: 'A/B: c', category: 'Articles', author: '' },
        'Fallback',
      ),
    ).toEqual({ dir: 'Articles', stem: 'A B c' })
    expect(
      renderNotePlacement('{category}/{title}', { title: '', category: '' }, 'Readwise 7'),
    ).toEqual({
      dir: '',
      stem: 'Readwise 7',
    })
  })
})

describe('normalizeConnectorPattern', () => {
  it('accepts known fields and names the problem otherwise', () => {
    expect(normalizeConnectorPattern(' /{category}/{title}/ ', readwiseConnector)).toBe(
      '{category}/{title}',
    )
    expect(() => normalizeConnectorPattern('{date}', readwiseConnector)).toThrow('{date}')
    expect(() => normalizeConnectorPattern('Notes', readwiseConnector)).toThrow(
      'at least one field',
    )
  })
})

describe('parseConnectorTags', () => {
  it('reads a comma list, dropping # and duplicates', () => {
    expect(parseConnectorTags('#readwise, type/reference, readwise, my tag,')).toEqual([
      'readwise',
      'type/reference',
      'my-tag',
    ])
  })
})
