import { describe, expect, it } from 'vitest'
import { formatCollectionEmbed, parseCollectionEmbeds } from './collection-embed'

describe('parseCollectionEmbeds', () => {
  it('reads tag and view from a fence', () => {
    expect(
      parseCollectionEmbeds('Intro\n\n```collection\ntag: books\nview: board\n```\n\nOutro\n'),
    ).toEqual([{ tag: 'books', view: 'board' }])
  })

  it('defaults the view to table and accepts a bare tag line', () => {
    expect(parseCollectionEmbeds('```collection\nbooks\n```\n')).toEqual([
      { tag: 'books', view: 'table' },
    ])
  })

  it('strips a leading hash on the tag and quoted values', () => {
    expect(parseCollectionEmbeds('```collection\ntag: "#Books"\nview: "calendar"\n```\n')).toEqual([
      { tag: 'Books', view: 'calendar' },
    ])
  })

  it('skips fences without a legal tag and keeps later ones', () => {
    const markdown = [
      '```collection\nview: board\n```',
      '```collection\ntag: projects\nview: kanban\n```',
      '```collection\ntag: not a tag\n```',
      '```ts\ntag: books\n```',
    ].join('\n\n')
    expect(parseCollectionEmbeds(markdown)).toEqual([{ tag: 'projects', view: 'table' }])
  })

  it('returns every well-formed fence in source order', () => {
    expect(
      parseCollectionEmbeds(
        '```collection\ntag: a\n```\n\ntext\n\n```collection\ntag: b\nview: calendar\n```\n',
      ),
    ).toEqual([
      { tag: 'a', view: 'table' },
      { tag: 'b', view: 'calendar' },
    ])
  })
})

describe('formatCollectionEmbed', () => {
  it('omits the default table view', () => {
    expect(formatCollectionEmbed({ tag: 'books', view: 'table' })).toBe(
      '```collection\ntag: books\n```',
    )
  })

  it('round-trips a non-default view', () => {
    const markdown = formatCollectionEmbed({ tag: 'projects', view: 'board' })
    expect(markdown).toBe('```collection\ntag: projects\nview: board\n```')
    expect(parseCollectionEmbeds(markdown)).toEqual([{ tag: 'projects', view: 'board' }])
  })
})
