import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createNoteIfAbsent, readNote, writeNote } from '../graph/commands'
import { normalizeConnectorFolder, syncConnector } from './sync'
import type { Connector, ConnectorNote } from './types'

const indexedRows = vi.hoisted(() => new Map<string, string>())

vi.mock('../graph/commands', () => ({
  createNoteIfAbsent: vi.fn(),
  readNote: vi.fn(),
  writeNote: vi.fn(),
}))
vi.mock('../indexing/db', () => {
  const query = {
    value: '',
    select: () => query,
    where: (column: string, _op: string, value: string) => {
      if (column === 'value') {
        query.value = value
      }
      return query
    },
    limit: () => query,
    executeTakeFirst: async () => {
      const notePath = indexedRows.get(query.value)
      return notePath === undefined ? undefined : { notePath }
    },
  }
  return { db: { selectFrom: () => query } }
})

const files = new Map<string, string>()

function note(sourceId: string, fileStem: string, body: string): ConnectorNote {
  return {
    sourceId,
    fileStem,
    source: `---\nsample_id: "${sourceId}"\n---\n${body}\n`,
    merge: (existing) => (existing.includes(body) ? null : `${existing}${body}\n`),
  }
}

function connector(notes: ConnectorNote[]): Connector {
  return {
    id: 'readwise',
    label: 'Sample',
    description: '',
    idKey: 'sample_id',
    defaultFolder: 'Sample',
    tokenUrl: '',
    tokenLabel: '',
    overlapMs: 0,
    verify: async () => {},
    async *fetchNotes() {
      yield* notes
    },
  }
}

function run(notes: ConnectorNote[]) {
  return syncConnector({
    connector: connector(notes),
    token: 'token',
    folder: 'Sample/',
    since: null,
    floor: null,
    generation: 1,
    fetchFn: fetch,
    isStale: () => false,
  })
}

beforeEach(() => {
  files.clear()
  indexedRows.clear()
  vi.mocked(createNoteIfAbsent).mockImplementation(async (path, contents) => {
    if (files.has(path)) {
      return { kind: 'collision' }
    }
    files.set(path, contents)
    return { kind: 'created', modifiedMs: 1 }
  })
  vi.mocked(readNote).mockImplementation(async (path) => {
    const contents = files.get(path)
    if (contents === undefined) {
      throw { kind: 'notFound', message: path }
    }
    return contents
  })
  vi.mocked(writeNote).mockImplementation(async (path, contents) => {
    files.set(path, contents)
  })
})

describe('syncConnector', () => {
  it('creates notes, never overwrites a foreign file, and merges into its own', async () => {
    files.set('Sample/Book.md', '# Book\n\nWritten by someone else\n')

    const first = await run([note('1', 'Book', 'alpha')])

    expect(first).toMatchObject({ created: 1, updated: 0 })
    expect(first.syncedAt).not.toBeNull()
    expect(files.get('Sample/Book.md')).toBe('# Book\n\nWritten by someone else\n')
    expect(files.get('Sample/Book 2.md')).toContain('alpha')

    // Index unaware of the note (another device wrote it): found by reading.
    const second = await run([note('1', 'Book', 'beta')])
    expect(second).toMatchObject({ created: 0, updated: 1 })
    expect(files.get('Sample/Book 2.md')).toContain('beta')

    // Found through the index even after a retitle changed its natural path.
    indexedRows.set('1', 'Sample/Book 2.md')
    const third = await run([note('1', 'Renamed', 'beta')])
    expect(third).toMatchObject({ created: 0, updated: 0 })
    expect(files.has('Sample/Renamed.md')).toBe(false)
  })
})

describe('syncConnector window', () => {
  it('looks back by the overlap but never before the import floor', async () => {
    const seen: (Date | null)[] = []
    const windowed: Connector = {
      ...connector([]),
      overlapMs: 60_000,
      async *fetchNotes(input) {
        seen.push(input.since)
      },
    }
    const base = {
      connector: windowed,
      token: 'token',
      folder: '',
      generation: 1,
      fetchFn: fetch,
      isStale: () => false,
    }

    await syncConnector({ ...base, since: new Date('2026-10-09T10:00:00Z'), floor: null })
    await syncConnector({
      ...base,
      since: new Date('2026-10-09T10:00:00Z'),
      floor: new Date('2026-10-09T09:59:30Z'),
    })
    await syncConnector({ ...base, since: null, floor: new Date('2026-10-01T00:00:00Z') })

    expect(seen.map((date) => date?.toISOString())).toEqual([
      '2026-10-09T09:59:00.000Z',
      '2026-10-09T09:59:30.000Z',
      '2026-10-01T00:00:00.000Z',
    ])
  })
})

describe('normalizeConnectorFolder', () => {
  it('accepts nested folders and rejects hidden or reserved ones', () => {
    expect(normalizeConnectorFolder(' /Library//Readwise/ ')).toBe('Library/Readwise')
    expect(normalizeConnectorFolder('')).toBe('')
    expect(() => normalizeConnectorFolder('.hidden')).toThrow()
    expect(() => normalizeConnectorFolder('assets')).toThrow()
  })
})
