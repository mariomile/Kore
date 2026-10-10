import { describe, expect, it, vi } from 'vitest'
import { granolaConnector, renderGranolaNote } from './granola'

vi.mock('./http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./http')>()),
  sleep: async () => {},
}))

const meeting = {
  id: 'not_abc',
  title: 'Weekly sync: roadmap',
  created_at: '2026-10-08T09:30:00',
  attendees: [
    { name: 'Ada', email: 'ada@example.com' },
    { name: null, email: 'bob@example.com' },
  ],
  summary_markdown: '### Decisions\n\n- Ship it',
}

describe('renderGranolaNote', () => {
  it('writes the summary under an H1 with meeting frontmatter', () => {
    expect(renderGranolaNote(meeting)).toBe(
      [
        '---',
        'granola_id: not_abc',
        'date: 2026-10-08',
        'attendees:',
        '  - Ada',
        '  - bob@example.com',
        'tags:',
        '  - meeting',
        '---',
        '# Weekly sync: roadmap',
        '',
        '### Decisions',
        '',
        '- Ship it',
        '',
      ].join('\n'),
    )
  })

  it('skips a meeting whose summary is not ready', () => {
    expect(renderGranolaNote({ ...meeting, summary_markdown: null })).toBeNull()
  })
})

describe('granolaConnector.fetchNotes', () => {
  it('pages the list and fetches details only for meetings the graph lacks', async () => {
    const urls: string[] = []
    const fetchFn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input)
      urls.push(url)
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer grn_key')
      if (url.includes('/notes/not_abc')) {
        return Response.json(meeting)
      }
      if (url.includes('cursor=next')) {
        return Response.json({ notes: [{ id: 'not_known' }], hasMore: false, cursor: null })
      }
      return Response.json({ notes: [{ id: 'not_abc' }], hasMore: true, cursor: 'next' })
    }

    const notes = []
    for await (const note of granolaConnector.fetchNotes({
      token: 'grn_key',
      since: null,
      fetchFn,
      isStale: () => false,
      hasNote: async (id) => id === 'not_known',
    })) {
      notes.push(note)
    }

    expect(urls).toEqual([
      'https://public-api.granola.ai/v1/notes?page_size=30',
      'https://public-api.granola.ai/v1/notes/not_abc',
      'https://public-api.granola.ai/v1/notes?page_size=30&cursor=next',
    ])
    expect(notes.map((note) => note.fileStem)).toEqual(['2026-10-08 Weekly sync roadmap'])
    expect(notes[0]?.merge('anything')).toBeNull()
  })
})
