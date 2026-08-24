import { describe, expect, it } from 'vitest'
import {
  extractHeadingSection,
  formatNoteTransclusion,
  parseNoteTransclusions,
  transclusionMarkdown,
  wikiEmbedKind,
} from './note-transclusion'

describe('wikiEmbedKind', () => {
  it('classifies images, other attachments, and notes', () => {
    expect(wikiEmbedKind('photo.png')).toBe('image')
    expect(wikiEmbedKind('assets/report.pdf')).toBe('file')
    expect(wikiEmbedKind('Some Note')).toBe('note')
    expect(wikiEmbedKind('Some Note#Heading')).toBe('note')
  })
})

describe('parseNoteTransclusions', () => {
  it('reads note embeds and heading fragments, skipping attachments and code', () => {
    const markdown = [
      'See ![[Dune]] and ![[Dune#Plot|the plot]].',
      '![[photo.png]]',
      '```',
      '![[Inside Fence]]',
      '```',
      'inline `![[code]]`',
    ].join('\n')
    expect(parseNoteTransclusions(markdown)).toEqual([
      { target: 'Dune', heading: null },
      { target: 'Dune', heading: 'Plot' },
    ])
  })

  it('round-trips through formatNoteTransclusion', () => {
    const embed = { target: 'Dune', heading: 'Plot' as const }
    expect(formatNoteTransclusion(embed)).toBe('![[Dune#Plot]]')
    expect(parseNoteTransclusions(formatNoteTransclusion(embed))).toEqual([
      { target: 'Dune', heading: 'Plot' },
    ])
  })
})

describe('extractHeadingSection', () => {
  const source = [
    '# Dune',
    '',
    'Intro.',
    '',
    '## Plot',
    '',
    'Sandworms.',
    '',
    '## Themes',
    '',
    'Power.',
  ].join('\n')

  it('slices from the matching heading to the next same-or-higher heading', () => {
    expect(extractHeadingSection(source, 'Plot')).toBe('## Plot\n\nSandworms.')
    expect(extractHeadingSection(source, 'plot')).toBe('## Plot\n\nSandworms.')
  })

  it('returns null when the heading is missing', () => {
    expect(extractHeadingSection(source, 'Appendix')).toBeNull()
  })

  it('keeps nested headings until the next same-or-higher heading', () => {
    const nested = [
      '# Dune',
      '',
      '## Plot',
      '',
      'Sandworms.',
      '',
      '### Arrakis',
      '',
      'Desert.',
      '',
      '## Themes',
      '',
      'Power.',
    ].join('\n')
    expect(extractHeadingSection(nested, 'Plot')).toBe(
      '## Plot\n\nSandworms.\n\n### Arrakis\n\nDesert.',
    )
  })
})

describe('transclusionMarkdown', () => {
  it('returns the body when no heading is asked for', () => {
    expect(transclusionMarkdown('---\ntitle: Dune\n---\n\nHello.\n', null)).toBe('Hello.')
  })
})
