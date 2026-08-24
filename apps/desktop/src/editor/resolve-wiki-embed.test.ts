import { describe, expect, it } from 'vitest'
import { resolveWikiEmbed } from './resolve-wiki-embed'

function embed(
  target: string,
  display = '',
): { target: string; display: string; width: null; height: null } {
  return { target, display, width: null, height: null }
}

describe('resolveWikiEmbed', () => {
  it('renders image and file embeds in the editor, and leaves notes as literals', () => {
    expect(resolveWikiEmbed(embed('photo.png', 'Cat'))).toEqual({
      kind: 'image',
      src: 'photo.png',
      alt: 'Cat',
    })
    expect(resolveWikiEmbed(embed('assets/report.pdf'))).toEqual({
      kind: 'file',
      href: 'assets/report.pdf',
    })
    expect(resolveWikiEmbed(embed('Dune#Plot'))).toBeUndefined()
  })
})
