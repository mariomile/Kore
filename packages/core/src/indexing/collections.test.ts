import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setBridge } from '../ipc/bridge'
import {
  getNoteProperties,
  getTagType,
  listCollection,
  listNoteTagTypes,
  listTagTypes,
  TITLE_SORT_KEY,
  UPDATED_SORT_KEY,
} from './collections'

// A fake bridge resolves `db_query` so the tests exercise the real compiled
// SQL (snake_case columns, parameters) — the same harness note-list.test uses.
const mockInvoke = vi.fn<(command: string, args: Record<string, unknown>) => Promise<unknown>>()

beforeEach(() => {
  mockInvoke.mockReset()
  setBridge({ invoke: mockInvoke, listen: async () => () => {} })
})

afterEach(() => {
  setBridge(null)
})

const bookSchema = '[{"name":"Author","key":"author","type":"text"}]'

describe('getTagType', () => {
  it('decodes the stored schema for a folded tag key', async () => {
    mockInvoke.mockResolvedValueOnce([{ schema_json: bookSchema }])
    const type = await getTagType('Book')
    expect(type).toEqual({ properties: [{ name: 'Author', key: 'author', type: 'text' }] })
    const [command, args] = mockInvoke.mock.calls[0]!
    expect(command).toBe('db_query')
    expect(String(args['sql'])).toContain('"tag_types"')
    expect(args['params']).toEqual(['book'])
  })

  it('treats a missing or mangled row as untyped', async () => {
    mockInvoke.mockResolvedValueOnce([])
    expect(await getTagType('book')).toBeNull()
    mockInvoke.mockResolvedValueOnce([{ schema_json: '{"nope":1}' }])
    expect(await getTagType('book')).toBeNull()
  })
})

describe('listTagTypes', () => {
  it('lists typed tags and skips mangled schema columns', async () => {
    mockInvoke.mockResolvedValueOnce([
      { tag_key: 'book', note_path: 'tags/book.md', schema_json: bookSchema },
      { tag_key: 'broken', note_path: 'tags/broken.md', schema_json: 'not json' },
    ])
    expect(await listTagTypes()).toEqual([
      {
        tagKey: 'book',
        notePath: 'tags/book.md',
        type: { properties: [{ name: 'Author', key: 'author', type: 'text' }] },
      },
    ])
  })
})

describe('listNoteTagTypes', () => {
  it('joins the note’s tags against tag_types, skipping mangled schemas', async () => {
    mockInvoke.mockResolvedValueOnce([
      { tag_key: 'book', note_path: 'tags/book.md', schema_json: bookSchema },
      { tag_key: 'broken', note_path: 'tags/broken.md', schema_json: '?' },
    ])
    const entries = await listNoteTagTypes('notes/a.md')
    expect(entries.map((entry) => entry.tagKey)).toEqual(['book'])
    const [, args] = mockInvoke.mock.calls[0]!
    expect(String(args['sql'])).toContain('inner join "tag_types"')
    expect(args['params']).toEqual(['notes/a.md'])
  })
})

describe('getNoteProperties', () => {
  it('maps one note’s property rows by key', async () => {
    mockInvoke.mockResolvedValueOnce([
      { key: 'author', value: 'Le Guin', value_type: 'string', value_number: null },
      { key: 'rating', value: '5', value_type: 'number', value_number: 5 },
    ])
    expect(await getNoteProperties('notes/a.md')).toEqual({
      author: { value: 'Le Guin', valueType: 'string', valueNumber: null },
      rating: { value: '5', valueType: 'number', valueNumber: 5 },
    })
  })
})

describe('listCollection', () => {
  it('maps rows with their property values, missing properties as empty', async () => {
    mockInvoke
      .mockResolvedValueOnce([
        { path: 'notes/a.md', title: 'A', mtime: 2, is_pinned: 0 },
        { path: 'notes/b.md', title: 'B', mtime: 1, is_pinned: 1 },
      ])
      .mockResolvedValueOnce([
        {
          note_path: 'notes/a.md',
          key: 'author',
          value: 'Le Guin',
          value_type: 'string',
          value_number: null,
        },
        {
          note_path: 'notes/a.md',
          key: 'rating',
          value: '4.5',
          value_type: 'number',
          value_number: 4.5,
        },
      ])

    const entries = await listCollection('Book')

    expect(entries).toEqual([
      {
        path: 'notes/a.md',
        title: 'A',
        mtime: 2,
        isPinned: false,
        properties: {
          author: { value: 'Le Guin', valueType: 'string', valueNumber: null },
          rating: { value: '4.5', valueType: 'number', valueNumber: 4.5 },
        },
      },
      { path: 'notes/b.md', title: 'B', mtime: 1, isPinned: true, properties: {} },
    ])

    // The unsorted list keeps the All Notes recall order: pinned first, then
    // newest — and both queries filter on the folded tag key.
    const [, listArgs] = mockInvoke.mock.calls[0]!
    const listSql = String(listArgs['sql'])
    expect(listArgs['params']).toContain('book')
    expect(listSql).toContain('"notes"."is_pinned" desc')
    expect(listSql).toContain('"notes"."mtime" desc')
    expect(listSql).not.toContain('limit')
    const [, propertyArgs] = mockInvoke.mock.calls[1]!
    const propertySql = String(propertyArgs['sql'])
    expect(propertySql).toContain('"note_properties"')
    expect(propertyArgs['params']).toContain('book')
    expect(propertySql).not.toContain('"note_path" in (')
  })

  it('sorts on a property with missing values last and the numeric key first', async () => {
    mockInvoke.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    await listCollection('book', { key: 'rating', direction: 'desc' })

    const [, args] = mockInvoke.mock.calls[0]!
    const sql = String(args['sql'])
    expect(sql).toContain('left join "note_properties" as "sort_property"')
    expect(args['params']).toContain('rating')
    const missingAt = sql.indexOf('"sort_property"."value" is null')
    const numberAt = sql.indexOf('"sort_property"."value_number" desc')
    const stringAt = sql.indexOf('"sort_property"."value" collate nocase desc')
    expect(missingAt).toBeGreaterThan(-1)
    expect(numberAt).toBeGreaterThan(missingAt)
    expect(stringAt).toBeGreaterThan(numberAt)
  })

  it('sorts on the built-in Title and Updated sentinels without a join', async () => {
    mockInvoke.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    await listCollection('book', { key: TITLE_SORT_KEY, direction: 'asc' })
    const titleSql = String(mockInvoke.mock.calls[0]![1]['sql'])
    expect(titleSql).toContain('"notes"."title" collate nocase asc')
    expect(titleSql).not.toContain('sort_property')

    mockInvoke.mockClear()
    mockInvoke.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    await listCollection('book', { key: UPDATED_SORT_KEY, direction: 'desc' })
    const updatedSql = String(mockInvoke.mock.calls[0]![1]['sql'])
    expect(updatedSql).toContain('"notes"."mtime" desc')
    expect(updatedSql).not.toContain('sort_property')
  })

  it('prefilters private rows in SQL when asked', async () => {
    mockInvoke.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    await listCollection('book', null, { excludePrivate: true })
    const sql = String(mockInvoke.mock.calls[0]![1]['sql'])
    expect(sql).toContain('"notes"."is_private" =')
  })

  it('returns early on an empty collection without a property query', async () => {
    mockInvoke.mockResolvedValueOnce([])
    expect(await listCollection('book')).toEqual([])
    expect(mockInvoke).toHaveBeenCalledTimes(1)
  })
})
