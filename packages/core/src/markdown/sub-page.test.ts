import { describe, expect, it } from 'vitest'
import { isPageBlockId, linePageId, newPageBlockId, pagePreview, pageTitle } from './sub-page'

describe('page ids', () => {
  it('reads the page marker at the end of a line, and only that kind of id', () => {
    expect(linePageId('Trip to Lisbon ^page-k3x9ab')).toBe('page-k3x9ab')
    expect(linePageId('Trip to Lisbon ^k3x9ab')).toBeNull()
    expect(linePageId('Trip to Lisbon')).toBeNull()
    expect(isPageBlockId('page-')).toBe(false)
  })
  it('mints ids that read back as page ids', () => {
    expect(linePageId(`x ^${newPageBlockId(() => 0.5)}`)).toBe('page-ssssss')
  })
})

describe('pageTitle', () => {
  it('drops the hidden marker', () => {
    expect(pageTitle('Trip to Lisbon ^page-k3x9ab')).toBe('Trip to Lisbon')
  })
})

describe('pageTitle as a reader sees it', () => {
  it('reads links as their labels and drops emphasis', () => {
    expect(
      pageTitle(
        '**Trip** to [[Lisbon|LX]] ([Location 6899](https://readwise.io/a?b=c)) ^page-a1b2c3',
      ),
    ).toBe('Trip to LX (Location 6899)')
    expect(pageTitle('See ![map](img.png) and `code`')).toBe('See map and code')
  })
})

describe('pagePreview', () => {
  it('flattens the children to text', () => {
    expect(pagePreview('- [ ] Book **flights** ^abcd12\n  - See [[Belém|Belem]]\n- Hotel\n')).toBe(
      'Book flights · See Belem · Hotel',
    )
  })
})
