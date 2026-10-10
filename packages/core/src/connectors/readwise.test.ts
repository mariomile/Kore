import { describe, expect, it } from 'vitest'
import {
  mergeReadwiseBook,
  readwiseConnector,
  readwiseHighlightIds,
  renderReadwiseBook,
  type ReadwiseBook,
} from './readwise'

function book(overrides: Partial<ReadwiseBook> = {}): ReadwiseBook {
  return {
    user_book_id: 42,
    title: 'Meditations',
    author: 'Marcus Aurelius',
    category: 'books',
    source_url: null,
    book_tags: [{ name: 'stoic philosophy' }],
    highlights: [
      { id: 2, text: 'Second', location: 20 },
      { id: 1, text: 'First\nline two', location: 10, note: 'Mine' },
      { id: 3, text: 'Gone', location: 30, is_discard: true },
    ],
    ...overrides,
  }
}

describe('renderReadwiseBook', () => {
  it('writes frontmatter, an H1 and live highlights in reading order', () => {
    expect(renderReadwiseBook(book())).toBe(
      [
        '---',
        'readwise_id: "42"',
        'author: Marcus Aurelius',
        'category: books',
        'tags:',
        '  - readwise',
        '  - stoic-philosophy',
        '---',
        '# Meditations',
        '',
        '**Author:** Marcus Aurelius',
        '',
        '## Highlights',
        '',
        '- First',
        '  line two ([View highlight](https://readwise.io/open/1))',
        '  - **Note:** Mine',
        '- Second ([View highlight](https://readwise.io/open/2))',
        '',
      ].join('\n'),
    )
  })
})

describe('mergeReadwiseBook', () => {
  it('appends only highlights the note does not carry and keeps user edits', () => {
    const existing = `${renderReadwiseBook(book())}\nMy own paragraph.\n`
    const next = book({
      highlights: [
        { id: 2, text: 'Second' },
        { id: 9, text: 'New one' },
      ],
    })

    const merged = mergeReadwiseBook(existing, next)

    expect(merged).toBe(
      `${existing.trimEnd()}\n\n- New one ([View highlight](https://readwise.io/open/9))\n`,
    )
    expect(readwiseHighlightIds(merged ?? '')).toEqual(new Set([1, 2, 9]))
    expect(mergeReadwiseBook(merged ?? '', next)).toBeNull()
  })
})

describe('readwiseConnector.fetchNotes', () => {
  it('follows the export cursor and sends the token', async () => {
    const urls: string[] = []
    const pages = [
      { nextPageCursor: 7, results: [book()] },
      {
        nextPageCursor: null,
        results: [book({ user_book_id: 43, title: 'Empty', highlights: [] })],
      },
    ]
    const fetchFn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      urls.push(String(input))
      expect(new Headers(init?.headers).get('Authorization')).toBe('Token secret')
      return Response.json(pages[urls.length - 1])
    }

    const notes = []
    for await (const note of readwiseConnector.fetchNotes({
      token: 'secret',
      since: new Date('2026-10-01T00:00:00.000Z'),
      fetchFn,
      isStale: () => false,
      hasNote: async () => false,
    })) {
      notes.push(note)
    }

    expect(urls).toEqual([
      'https://readwise.io/api/v2/export/?updatedAfter=2026-10-01T00%3A00%3A00.000Z',
      'https://readwise.io/api/v2/export/?updatedAfter=2026-10-01T00%3A00%3A00.000Z&pageCursor=7',
    ])
    expect(notes.map((note) => [note.sourceId, note.fileStem])).toEqual([['42', 'Meditations']])
  })
})
