import { describe, expect, it } from 'vitest'
import { pageCardTarget, planSubPage, subPagePreview } from './sub-page'

describe('pageCardTarget', () => {
  it('reads a line that is one wiki link', () => {
    expect(pageCardTarget('[[Trip to Lisbon]]')).toBe('Trip to Lisbon')
    expect(pageCardTarget(' [[Trip|the trip]] ')).toBe('Trip')
  })
  it('ignores prose, headings links, block links and dates', () => {
    expect(pageCardTarget('see [[Trip]]')).toBeNull()
    expect(pageCardTarget('[[Trip#Day 1]]')).toBeNull()
    expect(pageCardTarget('[[2026-11-16]]')).toBeNull()
    expect(pageCardTarget('[[A]] [[B]]')).toBeNull()
  })
})

describe('planSubPage', () => {
  it('names the page from the first line and keeps the children as its body', () => {
    expect(
      planSubPage('Trip to Lisbon [[2026-11-16]]', '  - Flights\n    - TAP\n  - Hotel'),
    ).toEqual({
      title: 'Trip to Lisbon',
      body: '- Flights\n  - TAP\n- Hotel',
      link: '[[Trip to Lisbon]]',
    })
  })
  it('unwraps links and drops characters a link cannot hold', () => {
    expect(planSubPage('Call [[Ada Lovelace|Ada]] #urgent', '')?.title).toBe('Call Ada urgent')
  })
  it('refuses a line with nothing to name', () => {
    expect(planSubPage('  [[2026-11-16]] ', '')).toBeNull()
  })
})

describe('subPagePreview', () => {
  it('drops frontmatter, the title H1 and markup', () => {
    const source = '---\nid: x\n---\n# Trip\n\n- [ ] Book **flights**\n- See [[Belém|Belem]]\n'
    expect(subPagePreview(source)).toBe('Book flights · See Belem')
  })
})
