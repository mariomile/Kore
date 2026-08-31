import { describe, expect, it } from 'vitest'
import { formatCollectionEmbed, parseCollectionEmbeds } from './collection-embed'

describe('parseCollectionEmbeds', () => {
  it('reads tag and view from a fence', () => {
    expect(
      parseCollectionEmbeds('Intro\n\n```collection\ntag: books\nview: board\n```\n\nOutro\n'),
    ).toEqual([{ tag: 'books', view: 'board', sort: null, filters: [] }])
  })

  it('defaults the view to table and accepts a bare tag line', () => {
    expect(parseCollectionEmbeds('```collection\nbooks\n```\n')).toEqual([
      { tag: 'books', view: 'table', sort: null, filters: [] },
    ])
  })

  it('accepts a bare #tag line as the tag, not a comment', () => {
    expect(parseCollectionEmbeds('```collection\n#books\n```\n')).toEqual([
      { tag: 'books', view: 'table', sort: null, filters: [] },
    ])
  })

  it('strips a leading hash on the tag and quoted values', () => {
    expect(parseCollectionEmbeds('```collection\ntag: "#Books"\nview: "calendar"\n```\n')).toEqual([
      { tag: 'Books', view: 'calendar', sort: null, filters: [] },
    ])
  })

  it('skips fences without a legal tag and keeps later ones', () => {
    const markdown = [
      '```collection\nview: board\n```',
      '```collection\ntag: projects\nview: kanban\n```',
      '```collection\ntag: not a tag\n```',
      '```ts\ntag: books\n```',
    ].join('\n\n')
    expect(parseCollectionEmbeds(markdown)).toEqual([
      { tag: 'projects', view: 'table', sort: null, filters: [] },
    ])
  })

  it('returns every well-formed fence in source order', () => {
    expect(
      parseCollectionEmbeds(
        '```collection\ntag: a\n```\n\ntext\n\n```collection\ntag: b\nview: calendar\n```\n',
      ),
    ).toEqual([
      { tag: 'a', view: 'table', sort: null, filters: [] },
      { tag: 'b', view: 'calendar', sort: null, filters: [] },
    ])
  })
})

describe('formatCollectionEmbed', () => {
  it('omits the default table view', () => {
    expect(formatCollectionEmbed({ tag: 'books', view: 'table', sort: null, filters: [] })).toBe(
      '```collection\ntag: books\n```',
    )
  })

  it('round-trips a non-default view', () => {
    const markdown = formatCollectionEmbed({
      tag: 'projects',
      view: 'board',
      sort: null,
      filters: [],
    })
    expect(markdown).toBe('```collection\ntag: projects\nview: board\n```')
    expect(parseCollectionEmbeds(markdown)).toEqual([
      { tag: 'projects', view: 'board', sort: null, filters: [] },
    ])
  })
})

describe('sort and filter lines (Plan 29 V1)', () => {
  it('parses the arrangement and round-trips it through the serializer', () => {
    const fence = [
      '```collection',
      'tag: book',
      'sort: rating desc',
      'filter: status = reading',
      'filter: author ~ le guin',
      'filter: rating > 3',
      'filter: due is empty',
      'filter: notes is set',
      '```',
    ].join('\n')
    const parsed = parseCollectionEmbeds(fence)
    expect(parsed).toEqual([
      {
        tag: 'book',
        view: 'table',
        sort: { key: 'rating', direction: 'desc' },
        filters: [
          { key: 'status', operator: 'is', text: 'reading' },
          { key: 'author', operator: 'contains', text: 'le guin' },
          { key: 'rating', operator: 'gt', text: '3' },
          { key: 'due', operator: 'empty', text: '' },
          { key: 'notes', operator: 'notEmpty', text: '' },
        ],
      },
    ])
    expect(parseCollectionEmbeds(formatCollectionEmbed(parsed[0]!))).toEqual(parsed)
  })

  it('skips malformed sort and filter lines without losing the fence', () => {
    const fence = [
      '```collection',
      'tag: book',
      'sort:   ',
      'filter: = reading',
      'filter: bad-!key = x',
      'filter: status =',
      '```',
    ].join('\n')
    expect(parseCollectionEmbeds(fence)).toEqual([
      { tag: 'book', view: 'table', sort: null, filters: [] },
    ])
  })
})
