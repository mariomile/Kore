import { describe, expect, it } from 'vitest'
import { cardBody, retitleLinkCard } from './resource-card'

describe('retitleLinkCard', () => {
  const card = `---\nurl: https://example.com/a\n---\n${cardBody('link', 'example.com', 'https://example.com/a')}`

  it('retitles the heading and the link label the card template wrote', () => {
    expect(retitleLinkCard(card, 'example.com', 'A [great] page')).toBe(
      '---\nurl: https://example.com/a\n---\n# A great page\n\n#link\n\n[A great page](https://example.com/a)\n',
    )
  })

  it('keeps a title the user already changed, and ignores an empty one', () => {
    const edited = card.replace('# example.com', '# Mine')
    expect(retitleLinkCard(edited, 'example.com', 'Page')).toBe(edited)
    expect(retitleLinkCard(card, 'example.com', '')).toBe(card)
  })
})
