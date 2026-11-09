import { describe, expect, it } from 'vitest'
import {
  blockIdsIn,
  blockLinkLabel,
  extractBlockSection,
  isBlockId,
  lineBlockId,
  newBlockId,
  noteLinkBlockId,
  withoutBlockIds,
} from './block-ids'
import { transclusionMarkdown } from './note-transclusion'

describe('lineBlockId', () => {
  it('reads an id at the end of a line or alone on it', () => {
    expect(lineBlockId('- price: 49€ ^price')).toBe('price')
    expect(lineBlockId('A paragraph ^a1-b2  ')).toBe('a1-b2')
    expect(lineBlockId('^table-1')).toBe('table-1')
  })

  it('ignores a caret inside a word or with characters Obsidian refuses', () => {
    expect(lineBlockId('2^10 is 1024')).toBeNull()
    expect(lineBlockId('x^2')).toBeNull()
    expect(lineBlockId('note ^bad_id')).toBeNull()
    expect(lineBlockId('mid ^id line')).toBeNull()
  })
})

describe('noteLinkBlockId', () => {
  it('reads the id after #^ and ignores headings', () => {
    expect(noteLinkBlockId('Journal#^price')).toBe('price')
    expect(noteLinkBlockId('Journal#^price|the price')).toBe('price')
    expect(noteLinkBlockId('#^local')).toBe('local')
    expect(noteLinkBlockId('Journal#Plans')).toBeNull()
    expect(noteLinkBlockId('Journal')).toBeNull()
    expect(noteLinkBlockId('Journal#^')).toBeNull()
  })
})

describe('newBlockId', () => {
  it('makes six valid characters', () => {
    const id = newBlockId()
    expect(id).toMatch(/^[a-z0-9]{6}$/)
    expect(isBlockId(id)).toBe(true)
    expect(newBlockId(() => 0)).toBe('aaaaaa')
  })
})

describe('blockIdsIn / withoutBlockIds', () => {
  const note = ['- one ^a', '```', 'code ^b', '```', 'para ^c', '', '| t |', '^d'].join('\n')

  it('lists ids outside fenced code', () => {
    expect(blockIdsIn(note)).toEqual(['a', 'c', 'd'])
  })

  it('leaves fenced code alone', () => {
    const md = ['```js', 'const x = a ^b', '^c', '```', 'text ^d'].join('\n')
    expect(withoutBlockIds(md)).toBe(['```js', 'const x = a ^b', '^c', '```', 'text'].join('\n'))
  })

  it('removes markers and id-only lines', () => {
    expect(withoutBlockIds('- one ^a\n| t |\n^d\nx^2')).toBe('- one\n| t |\nx^2')
  })
})

describe('extractBlockSection', () => {
  const source = [
    '# Pricing',
    '',
    'Intro line one',
    'intro line two ^intro',
    '',
    '- Plans',
    '  - Pro: 49€ ^pro',
    '    - billed monthly ^monthly',
    '    - annual -20%',
    '  - Team: 99€',
    '- Other',
    '',
    '> quoted',
    '> twice',
    '',
    '^quote',
    '',
    '```',
    'fake ^pro2',
    '```',
  ].join('\n')

  it('returns a list item with its children, dedented, markers removed', () => {
    expect(extractBlockSection(source, 'pro')).toBe(
      ['- Pro: 49€', '  - billed monthly', '  - annual -20%'].join('\n'),
    )
    expect(extractBlockSection(source, 'monthly')).toBe('- billed monthly')
  })

  it('returns the whole paragraph, not the heading above it', () => {
    expect(extractBlockSection(source, 'intro')).toBe('Intro line one\nintro line two')
  })

  it('returns the block above an id-only line', () => {
    expect(extractBlockSection(source, 'quote')).toBe('> quoted\n> twice')
  })

  it('returns a whole fenced block above an id-only line, blank lines included', () => {
    const md = [
      'Intro',
      '',
      '```js',
      'const a = 1',
      '',
      'const b = 2',
      '```',
      '',
      '^code',
      '',
    ].join('\n')
    expect(extractBlockSection(md, 'code')).toBe(
      ['```js', 'const a = 1', '', 'const b = 2', '```'].join('\n'),
    )
  })

  it('is null for a missing id or one inside code', () => {
    expect(extractBlockSection(source, 'nope')).toBeNull()
    expect(extractBlockSection(source, 'pro2')).toBeNull()
  })

  it('backs ![[Note#^id]] transclusions, after frontmatter', () => {
    const note = `---\ntitle: Pricing\n---\n${source}`
    expect(transclusionMarkdown(note, '^monthly')).toBe('- billed monthly')
    expect(transclusionMarkdown(note, '^missing')).toBeNull()
    expect(transclusionMarkdown(note, null)).not.toContain('49€ ^pro')
  })
})

describe('blockLinkLabel', () => {
  it('labels block links by note name; alias wins; other links are not its business', () => {
    expect(blockLinkLabel('Prezzi#^p1')).toBe('Prezzi')
    expect(blockLinkLabel('Prezzi#^p1|the price')).toBe('the price')
    expect(blockLinkLabel('#^q')).toBe('Link to line')
    expect(blockLinkLabel('Prezzi#Plans')).toBeNull()
    expect(blockLinkLabel('Prezzi')).toBeNull()
  })
})
