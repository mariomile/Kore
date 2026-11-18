import { describe, expect, it } from 'vitest'
import { NOTE_SKELETON_ROWS, noteSkeleton } from './note-skeleton'

describe('noteSkeleton', () => {
  it('draws the first blocks, skipping frontmatter and the title', () => {
    const rows = noteSkeleton(
      [
        '---',
        'tags: [project]',
        '---',
        '# Roadmap',
        '',
        '## Q1',
        'Ship the beta to the first ten teams.',
        '- [x] Pricing page',
        '- [ ] Onboarding',
        '  - Invite flow',
        '1. Measure activation',
        '> Keep it small',
      ].join('\n'),
    )
    expect(rows.map((row) => [row.kind, row.depth])).toEqual([
      ['heading', 0],
      ['text', 0],
      ['done', 0],
      ['task', 0],
      ['bullet', 1],
      ['ordered', 0],
    ])
  })

  it('draws each fenced block as one bar, admonitions as a quote', () => {
    const rows = noteSkeleton(
      [
        '# Roadmap',
        '```dataview',
        'TABLE status',
        '```',
        '```ad-warning',
        'Dates move.',
        '```',
      ].join('\n'),
    )
    expect(rows.map((row) => row.kind)).toEqual(['block', 'quote'])
  })

  it('drops tables, images and block ids, and caps the rows', () => {
    const rows = noteSkeleton(
      [
        '```',
        'const x = 1',
        '```',
        '| a | b |',
        '![[img.png]]',
        '^abc123',
        ...Array(20).fill('line'),
      ].join('\n'),
    )
    expect(rows).toHaveLength(NOTE_SKELETON_ROWS)
    expect(rows[0]?.kind).toBe('block')
    expect(rows.slice(1).every((row) => row.kind === 'text')).toBe(true)
  })

  it('keeps line widths between 0.3 and 1', () => {
    const [short, long] = noteSkeleton(['hi', 'x'.repeat(200)].join('\n'))
    expect(short?.width).toBe(0.3)
    expect(long?.width).toBe(1)
  })

  it('is empty for an empty note', () => {
    expect(noteSkeleton('# Only a title\n')).toEqual([])
  })
})
