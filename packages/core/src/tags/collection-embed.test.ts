import { describe, expect, it } from 'vitest'
import {
  formatCollectionEmbed,
  formatCollectionEmbedBody,
  parseCollectionEmbedBody,
  parseCollectionEmbeds,
} from './collection-embed'

describe('parseCollectionEmbeds', () => {
  it('reads tag and view from a fence', () => {
    expect(
      parseCollectionEmbeds('Intro\n\n```collection\ntag: books\nview: board\n```\n\nOutro\n'),
    ).toEqual([
      {
        selection: { kind: 'tag', tag: 'books' },
        view: 'board',
        sorts: [],
        group: null,
        filters: [],
        match: 'all',
      },
    ])
  })

  it('defaults the view to table and accepts a bare tag line', () => {
    expect(parseCollectionEmbeds('```collection\nbooks\n```\n')).toEqual([
      {
        selection: { kind: 'tag', tag: 'books' },
        view: 'table',
        sorts: [],
        group: null,
        filters: [],
        match: 'all',
      },
    ])
  })

  it('accepts a bare #tag line as the tag, not a comment', () => {
    expect(parseCollectionEmbeds('```collection\n#books\n```\n')).toEqual([
      {
        selection: { kind: 'tag', tag: 'books' },
        view: 'table',
        sorts: [],
        group: null,
        filters: [],
        match: 'all',
      },
    ])
  })

  it('strips a leading hash on the tag and quoted values', () => {
    expect(parseCollectionEmbeds('```collection\ntag: "#Books"\nview: "calendar"\n```\n')).toEqual([
      {
        selection: { kind: 'tag', tag: 'Books' },
        view: 'calendar',
        sorts: [],
        group: null,
        filters: [],
        match: 'all',
      },
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
      {
        selection: { kind: 'tag', tag: 'projects' },
        view: 'table',
        sorts: [],
        group: null,
        filters: [],
        match: 'all',
      },
    ])
  })

  it('returns every well-formed fence in source order', () => {
    expect(
      parseCollectionEmbeds(
        '```collection\ntag: a\n```\n\ntext\n\n```collection\ntag: b\nview: calendar\n```\n',
      ),
    ).toEqual([
      {
        selection: { kind: 'tag', tag: 'a' },
        view: 'table',
        sorts: [],
        group: null,
        filters: [],
        match: 'all',
      },
      {
        selection: { kind: 'tag', tag: 'b' },
        view: 'calendar',
        sorts: [],
        group: null,
        filters: [],
        match: 'all',
      },
    ])
  })

  it('round-trips a reusable definition reference while keeping legacy tags', () => {
    const embed = {
      selection: { kind: 'definition' as const, reference: '01KORECOLLECTION' },
      view: 'table' as const,
      sorts: [],
      group: null,
      filters: [],
      match: 'all' as const,
    }
    expect(formatCollectionEmbedBody(embed)).toBe('collection: 01KORECOLLECTION')
    expect(parseCollectionEmbedBody(formatCollectionEmbedBody(embed))).toEqual(embed)
    expect(parseCollectionEmbeds(formatCollectionEmbed(embed))).toEqual([embed])
  })

  it('persists hidden inline columns without changing legacy defaults', () => {
    const parsed = parseCollectionEmbedBody(
      ['collection: 01KORECOLLECTION', 'hide: status', 'hide: status', 'hide: bad key'].join('\n'),
    )
    expect(parsed?.hidden).toEqual(['status'])
    expect(formatCollectionEmbedBody(parsed!)).toContain('hide: status')
  })
})

describe('formatCollectionEmbed', () => {
  it('omits the default table view', () => {
    expect(
      formatCollectionEmbed({
        selection: { kind: 'tag', tag: 'books' },
        view: 'table',
        sorts: [],
        group: null,
        filters: [],
        match: 'all',
      }),
    ).toBe('```collection\ntag: books\n```')
  })

  it('round-trips a non-default view', () => {
    const markdown = formatCollectionEmbed({
      selection: { kind: 'tag', tag: 'projects' },
      view: 'board',
      sorts: [],
      match: 'all',
      group: null,
      filters: [],
    })
    expect(markdown).toBe('```collection\ntag: projects\nview: board\n```')
    expect(parseCollectionEmbeds(markdown)).toEqual([
      {
        selection: { kind: 'tag', tag: 'projects' },
        view: 'board',
        sorts: [],
        group: null,
        filters: [],
        match: 'all',
      },
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
        selection: { kind: 'tag', tag: 'book' },
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
      {
        selection: { kind: 'tag', tag: 'book' },
        view: 'table',
        sorts: [],
        group: 'status',
        filters: [],
        match: 'all',
      },
    ])
    expect(formatCollectionEmbed(parsed[0]!)).toBe(fence)
    expect(
      parseCollectionEmbeds(['```collection', 'tag: book', 'group: bad !key', '```'].join('\n')),
    ).toEqual([
      {
        selection: { kind: 'tag', tag: 'book' },
        view: 'table',
        sorts: [],
        group: null,
        filters: [],
        match: 'all',
      },
    ])
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
      {
        selection: { kind: 'tag', tag: 'book' },
        view: 'table',
        sorts: [],
        group: null,
        filters: [],
        match: 'all',
      },
    ])
  })
})
