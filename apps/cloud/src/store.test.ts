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
      { path: 'n.md', source: null, version: 2, seq: 2, updatedAt: expect.any(String) },
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
