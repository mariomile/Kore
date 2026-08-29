import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setBridge } from '../ipc/bridge'
import { listNotes, listNoteTags, listRecentNotes } from './note-list'

// A fake bridge resolves `db_query` so the tests exercise the real compiled
// SQL (snake_case columns, parameters) — the same harness queries.test uses.
const mockInvoke = vi.fn<(command: string, args: Record<string, unknown>) => Promise<unknown>>()

beforeEach(() => {
  mockInvoke.mockReset()
  setBridge({ invoke: mockInvoke, listen: async () => () => {} })
})

afterEach(() => {
  setBridge(null)
})

describe('listNotes', () => {
  it('lists non-daily notes pinned-first then newest with stored previews and folded tags', async () => {
    mockInvoke.mockResolvedValueOnce([
      {
        path: 'notes/pinned.md',
        title: 'Pinned Plan',
        mtime: 500,
        preview: 'Always on top.',
        is_pinned: 1,
        pinned_order: 1,
        tags: null,
      },
      {
        path: 'notes/health.md',
        title: 'Health Stacked',
        mtime: 2000,
        preview: 'Shop your health goals.',
        is_pinned: 0,
        pinned_order: null,
        tags: 'health\u{1F}link',
      },
    ])

    const entries = await listNotes()

    expect(entries).toEqual([
      {
        path: 'notes/pinned.md',
        title: 'Pinned Plan',
        mtime: 500,
        snippet: 'Always on top.',
        tags: [],
        isPinned: true,
      },
      {
        path: 'notes/health.md',
        title: 'Health Stacked',
        mtime: 2000,
        snippet: 'Shop your health goals.',
        tags: ['health', 'link'],
        isPinned: false,
      },
    ])

    // One query, not two: the tags ride along instead of arriving as their own
    // uncapped listing to be stitched together in JS.
    expect(mockInvoke).toHaveBeenCalledTimes(1)
    const [command, args] = mockInvoke.mock.calls[0]!
    expect(command).toBe('db_query')
    const sql = String(args['sql'])
    // The snippet is the stored projection column: no note_text join, no
    // per-query derivation.
    expect(sql).toContain('"preview"')
    expect(sql).not.toContain('note_text')
    // `kind = 'note'` excludes dailies (the stream is their home) and templates.
    expect(sql).toContain('"notes"."kind" = ?')
    // A left join, so a note with no tags still appears.
    expect(sql).toContain('left join "tags"')
    expect(sql).toContain('group_concat')
    expect(sql).toContain('group by "notes"."path"')
    // Pinned notes lead (explicit order first), then recency: V1's list order,
    // via the recallOrder helper shared with filtered-search.
    const pinnedAt = sql.indexOf('"notes"."is_pinned" desc')
    const orderAt = sql.indexOf('"notes"."pinned_order" is null')
    const mtimeAt = sql.indexOf('"notes"."mtime" desc')
    expect(pinnedAt).toBeGreaterThan(-1)
    expect(orderAt).toBeGreaterThan(pinnedAt)
    expect(mtimeAt).toBeGreaterThan(orderAt)
    // Uncapped: the screen virtualizes instead.
    expect(sql).not.toContain('limit')
    // Never a `note_path IN (...)` list, whose per-row parameter would hit
    // SQLite's bound-parameter ceiling on large graphs.
    expect(sql).not.toContain(' in (')
    expect(args['params']).toEqual(['note'])
  })

  it('narrows to one tag with an EXISTS and includes tagged daily notes', async () => {
    mockInvoke.mockResolvedValueOnce([
      {
        path: 'notes/health.md',
        title: 'Health Stacked',
        mtime: 2000,
        preview: '',
        is_pinned: 0,
        pinned_order: null,
        tags: null,
      },
      {
        path: 'daily/2026-06-09.md',
        title: 'June 9, 2026',
        mtime: 1500,
        preview: 'Read a book.',
        is_pinned: 0,
        pinned_order: null,
        tags: 'Book',
      },
    ])

    const entries = await listNotes({ tag: 'Book' })

    expect(entries.map((entry) => entry.path)).toEqual(['notes/health.md', 'daily/2026-06-09.md'])
    expect(entries[1]?.tags).toEqual(['Book'])

    expect(mockInvoke).toHaveBeenCalledTimes(1)
    const [, args] = mockInvoke.mock.calls[0]!
    const sql = String(args['sql'])
    // An EXISTS, not a join on the filter tag: joining it would multiply the
    // grouped rows for a note matching more than once, and the aggregate
    // cannot be rescued by a `distinct` the way the old two-query shape was.
    expect(sql).toContain('exists')
    expect(sql).toContain('"filter_tags"."tag_key"')
    expect(sql).not.toContain('inner join "tags" as "filter_tags"')
    // Tag matching is the folded key, never SQLite's ASCII-only lower().
    expect(sql).not.toContain('lower(')
    // Kind first, then the folded tag: the EXISTS is appended after the kind
    // narrowing, so the bound order follows the builder, not the SQL text.
    expect(args['params']).toEqual(['note', 'daily', 'book'])
  })

  it('returns nothing when no notes match, without a second round trip', async () => {
    mockInvoke.mockResolvedValue([])
    await expect(listNotes({ tag: 'nothing' })).resolves.toEqual([])
    expect(mockInvoke).toHaveBeenCalledTimes(1)
  })
})

describe('listRecentNotes', () => {
  it('caps public non-daily rows, newest first, with a boolean privacy flag', async () => {
    mockInvoke.mockResolvedValueOnce([
      {
        path: 'notes/health.md',
        title: 'Health Stacked',
        preview: 'Shop your health goals.',
        mtime: 2000,
        is_private: 0,
      },
    ])

    const rows = await listRecentNotes({ limit: 5 })

    expect(rows).toEqual([
      {
        path: 'notes/health.md',
        title: 'Health Stacked',
        preview: 'Shop your health goals.',
        mtime: 2000,
        isPrivate: false,
      },
    ])
    const [command, args] = mockInvoke.mock.calls[0]!
    expect(command).toBe('db_query')
    const sql = String(args['sql'])
    expect(sql).toContain('"notes"."kind" = ?')
    expect(sql).toContain('"is_private"')
    expect(sql).toContain('order by "notes"."mtime" desc')
    expect(sql).toContain('limit')
    expect(args['params']).toEqual(['note', 0, 5])
  })

  it('narrows to one tag via the stored folded tag_key', async () => {
    mockInvoke.mockResolvedValueOnce([])

    await listRecentNotes({ limit: 5, tag: 'Book' })

    const [, args] = mockInvoke.mock.calls[0]!
    const sql = String(args['sql'])
    expect(sql).toContain('from "tags"')
    expect(sql).toContain('inner join "notes"')
    expect(sql).toContain('"tags"."tag_key"')
    expect(sql).not.toContain('exists')
    expect(sql).not.toContain('lower(')
    expect(args['params']).toEqual(['book', 'note', 0, 5])
  })
})

describe('listNoteTags', () => {
  it('groups tags on the stored key over non-daily notes', async () => {
    mockInvoke.mockResolvedValue([
      { tag: 'Book', count: 3 },
      { tag: 'link', count: 12 },
    ])

    const facets = await listNoteTags()

    expect(facets).toEqual([
      { tag: 'Book', count: 3 },
      { tag: 'link', count: 12 },
    ])
    const [command, args] = mockInvoke.mock.calls[0]!
    expect(command).toBe('db_query')
    const sql = String(args['sql'])
    expect(sql).toContain('"notes"."kind" = ?')
    expect(sql).toContain('group by "tags"."tag_key"')
  })
})
