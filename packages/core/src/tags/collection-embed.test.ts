import { describe, expect, it } from 'vitest'
import { formatCollectionEmbed, parseCollectionEmbeds } from './collection-embed'

describe('parseCollectionEmbeds', () => {
  it('reads tag and view from a fence', () => {
    expect(
      parseCollectionEmbeds('Intro\n\n```collection\ntag: books\nview: board\n```\n\nOutro\n'),
    ).toEqual([{ tag: 'books', view: 'board', sorts: [], group: null, filters: [], match: 'all' }])
  })

  it('defaults the view to table and accepts a bare tag line', () => {
    expect(parseCollectionEmbeds('```collection\nbooks\n```\n')).toEqual([
      { tag: 'books', view: 'table', sorts: [], group: null, filters: [], match: 'all' },
    ])
  })

  it('accepts a bare #tag line as the tag, not a comment', () => {
    expect(parseCollectionEmbeds('```collection\n#books\n```\n')).toEqual([
      { tag: 'books', view: 'table', sorts: [], group: null, filters: [], match: 'all' },
    ])
  })

  it('strips a leading hash on the tag and quoted values', () => {
    expect(parseCollectionEmbeds('```collection\ntag: "#Books"\nview: "calendar"\n```\n')).toEqual([
      { tag: 'Books', view: 'calendar', sorts: [], group: null, filters: [], match: 'all' },
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
      { tag: 'projects', view: 'table', sorts: [], group: null, filters: [], match: 'all' },
    ])
  })

  it('returns every well-formed fence in source order', () => {
    expect(
      parseCollectionEmbeds(
        '```collection\ntag: a\n```\n\ntext\n\n```collection\ntag: b\nview: calendar\n```\n',
      ),
    ).toEqual([
      { tag: 'a', view: 'table', sorts: [], group: null, filters: [], match: 'all' },
      { tag: 'b', view: 'calendar', sorts: [], group: null, filters: [], match: 'all' },
    ])
  })
})

describe('formatCollectionEmbed', () => {
  it('omits the default table view', () => {
    expect(
      formatCollectionEmbed({ tag: 'books', view: 'table', sorts: [], group: null, filters: [], match: 'all' }),
    ).toBe('```collection\ntag: books\n```')
  })

  it('round-trips a non-default view', () => {
    const markdown = formatCollectionEmbed({
      tag: 'projects',
      view: 'board',
      sorts: [],
      match: 'all',
      group: null,
      filters: [],
    })
    expect(markdown).toBe('```collection\ntag: projects\nview: board\n```')
    expect(parseCollectionEmbeds(markdown)).toEqual([
      { tag: 'projects', view: 'board', sorts: [], group: null, filters: [], match: 'all' },
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
        sorts: [{ key: 'rating', direction: 'desc' }],
        group: null,
        filters: [
          { key: 'status', operator: 'is', text: 'reading' },
          { key: 'author', operator: 'contains', text: 'le guin' },
          { key: 'rating', operator: 'gt', text: '3' },
          { key: 'due', operator: 'empty', text: '' },
          { key: 'notes', operator: 'notEmpty', text: '' },
        ],
        match: 'all',
      },
    ])
    expect(parseCollectionEmbeds(formatCollectionEmbed(parsed[0]!))).toEqual(parsed)
  })

  it('round-trips a sort chain and a match: any line', () => {
    const fence = [
      '```collection',
      'tag: book',
      'sort: status',
      'sort: rating desc',
      'filter: status = reading',
      'filter: rating > 4',
      'match: any',
      '```',
    ].join('\n')
    const parsed = parseCollectionEmbeds(fence)
    expect(parsed[0]?.sorts).toEqual([
      { key: 'status', direction: 'asc' },
      { key: 'rating', direction: 'desc' },
    ])
    expect(parsed[0]?.match).toBe('any')
    expect(parseCollectionEmbeds(formatCollectionEmbed(parsed[0]!))).toEqual(parsed)
  })

  it('round-trips a group: line and skips a malformed one', () => {
    const fence = ['```collection', 'tag: book', 'group: status', '```'].join('\n')
    const parsed = parseCollectionEmbeds(fence)
    expect(parsed).toEqual([
      { tag: 'book', view: 'table', sorts: [], group: 'status', filters: [], match: 'all' },
    ])
    expect(formatCollectionEmbed(parsed[0]!)).toBe(fence)
    expect(
      parseCollectionEmbeds(['```collection', 'tag: book', 'group: bad !key', '```'].join('\n')),
    ).toEqual([{ tag: 'book', view: 'table', sorts: [], group: null, filters: [], match: 'all' }])
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
      { tag: 'book', view: 'table', sorts: [], group: null, filters: [], match: 'all' },
    ])
  })
})
