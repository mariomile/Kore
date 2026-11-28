import { beforeEach, describe, expect, it } from 'vitest'
import { fakeD1 } from './d1-fake'
import { NoteStore, ftsQuery } from './store'

let store: NoteStore

beforeEach(async () => {
  let tick = 0
  store = new NoteStore(
    fakeD1().binding,
    () => `2026-11-09T10:00:${String(tick++).padStart(2, '0')}Z`,
  )
  await store.ensureSchema()
})

describe('NoteStore', () => {
  it('creates a note at version 1 and indexes its title, tags and text', async () => {
    const outcome = await store.write({
      path: 'notes/pricing.md',
      source: '# Pricing\n\nSeat-based plans for agencies. #strategy\n',
      baseVersion: 0,
    })
    expect(outcome).toEqual({ status: 'ok', version: 1, seq: 1 })
    const note = await store.get('notes/pricing.md')
    expect(note).toMatchObject({ title: 'Pricing', version: 1, daily: null })
    expect((await store.search('agencies', 5)).map((hit) => hit.path)).toEqual(['notes/pricing.md'])
    expect((await store.search('strat', 5)).map((hit) => hit.path)).toEqual(['notes/pricing.md'])
  })

  it('matches without accents and ranks a title hit above a body hit', async () => {
    await store.write({ path: 'a.md', source: '# Notes\n\nCaffè e città\n', baseVersion: 0 })
    await store.write({ path: 'b.md', source: '# Città\n\nRoma\n', baseVersion: 0 })
    expect((await store.search('citta', 5)).map((hit) => hit.path)).toEqual(['b.md', 'a.md'])
  })

  it('refuses a write whose base version is stale and returns the current note', async () => {
    await store.write({ path: 'n.md', source: '# N\n\none\n', baseVersion: 0 })
    await store.write({ path: 'n.md', source: '# N\n\ntwo\n', baseVersion: 1 })
    const stale = await store.write({ path: 'n.md', source: '# N\n\nmine\n', baseVersion: 1 })
    expect(stale).toEqual({ status: 'conflict', version: 2, source: '# N\n\ntwo\n' })
    expect((await store.get('n.md'))?.source).toBe('# N\n\ntwo\n')
  })

  it('refuses to create over a live note', async () => {
    await store.write({ path: 'n.md', source: '# N\n', baseVersion: 0 })
    expect(await store.write({ path: 'n.md', source: '# Other\n', baseVersion: 0 })).toMatchObject({
      status: 'conflict',
      version: 1,
    })
  })

  it('keeps a deletion as a tombstone the change feed reports, and lets the path be created again', async () => {
    await store.write({ path: 'n.md', source: '# Gone soon\n', baseVersion: 0 })
    expect(await store.write({ path: 'n.md', source: null, baseVersion: 1 })).toEqual({
      status: 'ok',
      version: 2,
      seq: 2,
    })
    expect(await store.get('n.md')).toBeNull()
    expect(await store.search('gone', 5)).toEqual([])
    const feed = await store.changes(1, 10)
    expect(feed).toEqual([
      {
        path: 'n.md',
        source: null,
        version: 2,
        seq: 2,
        updatedAt: expect.any(String),
        author: null,
      },
    ])
    expect(await store.write({ path: 'n.md', source: '# Back\n', baseVersion: 0 })).toMatchObject({
      status: 'ok',
      version: 3,
    })
  })

  it('treats deleting a note that is already gone as done', async () => {
    expect(await store.write({ path: 'never.md', source: null, baseVersion: 0 })).toMatchObject({
      status: 'ok',
      version: 0,
    })
  })

  it('orders the change feed by seq across notes and pages through it', async () => {
    await store.writeMany([
      { path: 'a.md', source: '# A\n', baseVersion: 0 },
      { path: 'b.md', source: '# B\n', baseVersion: 0 },
      { path: 'c.md', source: '# C\n', baseVersion: 0 },
    ])
    await store.write({ path: 'a.md', source: '# A2\n', baseVersion: 1 })
    expect((await store.changes(0, 2)).map((change) => change.path)).toEqual(['b.md', 'c.md'])
    expect((await store.changes(3, 10)).map((change) => [change.path, change.seq])).toEqual([
      ['a.md', 4],
    ])
  })

  it('resolves daily notes by date in the default layout', async () => {
    await store.write({ path: 'daily/2026-11-09.md', source: 'Met Dana\n', baseVersion: 0 })
    expect((await store.byDaily('2026-11-09'))?.path).toBe('daily/2026-11-09.md')
  })

  it('finds a note by title regardless of case and counts notes per folder', async () => {
    await store.write({ path: 'notes/x.md', source: '# Meeting Notes\n', baseVersion: 0 })
    await store.write({ path: 'AGENTS.md', source: '# Rules\n', baseVersion: 0 })
    expect((await store.byTitle('meeting notes'))?.path).toBe('notes/x.md')
    expect(await store.folders()).toEqual(
      expect.arrayContaining([
        { folder: 'notes', notes: 1 },
        { folder: '', notes: 1 },
      ]),
    )
  })
})

describe('ftsQuery', () => {
  it('quotes every term so input is never FTS5 syntax', () => {
    expect(ftsQuery('pricing OR "x" NEAR(a) -b')).toBe('"pricing" "OR" "x" "NEAR" "a" "b"*')
    expect(ftsQuery('  ')).toBe('')
  })
})

describe('NoteStore history', () => {
  let minute = 0
  let timed: NoteStore

  beforeEach(async () => {
    minute = 0
    timed = new NoteStore(fakeD1().binding, () => {
      const at = new Date(Date.UTC(2026, 10, 28, 10, 0) + minute * 60_000).toISOString()
      minute += 1
      return at
    })
    await timed.ensureSchema()
  })

  it('keeps one snapshot per ten minutes while the same writer types, newest first', async () => {
    for (let version = 0; version < 13; version += 1) {
      await timed.write({ path: 'n.md', source: `# N\n\n${version}\n`, baseVersion: version })
    }
    const versions = await timed.history('n.md', 50)
    expect(versions.map((entry) => entry.version)).toEqual([11, 1])
    expect((await timed.version(versions[1]?.id ?? 0))?.source).toBe('# N\n\n0\n')
  })

  it('always keeps the text a different writer replaces', async () => {
    await timed.write({ path: 'n.md', source: '# Mine\n', baseVersion: 0 })
    await timed.write({ path: 'n.md', source: '# Agent\n', baseVersion: 1, author: 'Grok' })
    await timed.write({ path: 'n.md', source: '# Mine again\n', baseVersion: 2 })
    const versions = await timed.history('n.md', 50)
    expect(versions.map((entry) => [entry.version, entry.author, entry.replacedBy])).toEqual([
      [2, 'Grok', null],
      [1, null, 'Grok'],
    ])
  })

  it('keeps a deleted note in the trash with the text it had, until it is restored', async () => {
    await timed.write({ path: 'n.md', source: '# Keep me\n', baseVersion: 0 })
    await timed.write({ path: 'n.md', source: null, baseVersion: 1 })
    const [trashed] = await timed.trash(10)
    expect(trashed).toMatchObject({ path: 'n.md', version: 1, deleted: true })
    expect((await timed.version(trashed?.id ?? 0))?.source).toBe('# Keep me\n')
    expect(
      await timed.write({ path: 'n.md', source: '# Keep me\n', baseVersion: 0 }),
    ).toMatchObject({ status: 'ok', version: 3 })
    expect(await timed.trash(10)).toEqual([])
  })

  it('counts live notes and recent deletions for the mass-deletion guard', async () => {
    await timed.write({ path: 'a.md', source: '# A\n', baseVersion: 0 })
    await timed.write({ path: 'b.md', source: '# B\n', baseVersion: 0 })
    await timed.write({ path: 'a.md', source: null, baseVersion: 1 })
    expect(await timed.deletionPressure(60 * 60_000)).toEqual({ live: 1, recentlyDeleted: 1 })
    minute += 120
    expect(await timed.deletionPressure(60 * 60_000)).toEqual({ live: 1, recentlyDeleted: 0 })
  })

  it('prunes versions older than a year', async () => {
    const db = fakeD1().binding
    let now = '2025-11-01T10:00:00.000Z'
    const aging = new NoteStore(db, () => now)
    await aging.ensureSchema()
    await aging.write({ path: 'n.md', source: '# Old\n', baseVersion: 0 })
    now = '2025-11-01T11:00:00.000Z'
    await aging.write({ path: 'n.md', source: '# Newer\n', baseVersion: 1 })
    expect(await aging.history('n.md', 10)).toHaveLength(1)
    now = '2026-11-28T10:00:00.000Z'
    await aging.write({ path: 'other.md', source: '# Other\n', baseVersion: 0 })
    expect(await aging.history('n.md', 10)).toEqual([])
  })
})
