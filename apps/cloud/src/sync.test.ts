import { beforeEach, describe, expect, it } from 'vitest'
import { fakeD1 } from './d1-fake'
import { NoteStore } from './store'
import { MASS_DELETION_REASON, MAX_PUSH_WRITES, MAX_UNPARSED_PUSH_WRITES, handleSync } from './sync'

let store: NoteStore

beforeEach(async () => {
  store = new NoteStore(fakeD1().binding)
  await store.ensureSchema()
})

async function push(writes: unknown) {
  return await handleSync(
    new Request('https://kore.example/sync/push', {
      method: 'POST',
      body: JSON.stringify({ writes }),
    }),
    store,
  )
}
async function pull(query: string) {
  return await handleSync(new Request(`https://kore.example/sync/changes${query}`), store)
}

describe('sync API', () => {
  it('pushes writes, reports conflicts and rejections per note, and pulls them back', async () => {
    const first = await push([
      { path: 'a.md', source: '# A\n', baseVersion: 0 },
      { path: 'b.md', source: '---\nprivate: true\n---\nsecret\n', baseVersion: 0 },
      { path: '.git/config.md', source: 'x', baseVersion: 0 },
    ])
    expect(first.status).toBe(200)
    expect((await first.json()) as unknown).toEqual({
      results: [
        { path: 'a.md', status: 'ok', version: 1, seq: 1 },
        { path: 'b.md', status: 'rejected', reason: 'private notes never enter Kore Cloud' },
        { path: '.git/config.md', status: 'rejected', reason: expect.any(String) },
      ],
    })
    const stale = await push([{ path: 'a.md', source: '# A from an old copy\n', baseVersion: 0 }])
    expect(((await stale.json()) as { results: unknown[] }).results).toEqual([
      { path: 'a.md', status: 'conflict', version: 1, source: '# A\n' },
    ])
    const feed = (await (await pull('?since=0')).json()) as {
      changes: unknown[]
      cursor: number
      more: boolean
    }
    expect(feed).toMatchObject({ cursor: 1, more: false })
    expect(feed.changes).toHaveLength(1)
  })

  it('pages the change feed', async () => {
    await push([1, 2, 3].map((n) => ({ path: `${n}.md`, source: `# ${n}\n`, baseVersion: 0 })))
    const page = (await (await pull('?since=0&limit=2')).json()) as {
      cursor: number
      more: boolean
    }
    expect(page).toMatchObject({ cursor: 2, more: true })
  })

  it('rejects malformed requests', async () => {
    expect((await push('nope')).status).toBe(400)
    expect((await push([{ path: 'a.md', source: 1, baseVersion: 0 }])).status).toBe(400)
    const many = Array.from({ length: MAX_PUSH_WRITES + 1 }, (_, n) => ({
      path: `${n}.md`,
      source: '',
      baseVersion: 0,
    }))
    expect((await push(many)).status).toBe(400)
    expect((await pull('?since=-1')).status).toBe(400)
  })
})

describe('sync meta', () => {
  it('stores client-parsed meta and caps the writes the Worker must parse', async () => {
    const meta = { title: 'From the app', tags: ['x'], text: 'parsed elsewhere' }
    const response = await push([{ path: 'a.md', source: '# A\n', baseVersion: 0, meta }])
    expect(response.status).toBe(200)
    expect((await store.get('a.md'))?.title).toBe('From the app')
    expect((await store.search('elsewhere', 5)).map((hit) => hit.path)).toEqual(['a.md'])
    const unparsed = Array.from({ length: MAX_UNPARSED_PUSH_WRITES + 1 }, (_, n) => ({
      path: `n${n}.md`,
      source: `# ${n}\n`,
      baseVersion: 0,
    }))
    expect((await push(unparsed)).status).toBe(400)
    expect(
      (await push([{ path: 'b.md', source: '', baseVersion: 0, meta: { title: 1 } }])).status,
    ).toBe(400)
  })
})

describe('sync meta caps', () => {
  it('refuses meta text larger than a note may be', async () => {
    const meta = { title: 't', tags: [], text: 'x'.repeat(1_000_001) }
    expect((await push([{ path: 'a.md', source: '# A\n', baseVersion: 0, meta }])).status).toBe(400)
  })
})

describe('sync mass-deletion guard', () => {
  const now = Date.parse('2026-11-28T10:30:00.000Z')
  let clocked: NoteStore

  beforeEach(async () => {
    clocked = new NoteStore(fakeD1().binding, () => new Date(now).toISOString())
    await clocked.ensureSchema()
    for (let start = 0; start < 40; start += 20) {
      await clocked.writeMany(
        Array.from({ length: 20 }, (_, n) => ({
          path: `${start + n}.md`,
          source: `# ${start + n}\n`,
          baseVersion: 0,
        })),
      )
    }
  })

  async function pushTo(body: unknown) {
    const response = await handleSync(
      new Request('https://kore.example/sync/push', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
      clocked,
    )
    return (await response.json()) as {
      paused?: { deleted: number; tracked: number }
      results: { path: string; status: string; reason?: string }[]
    }
  }

  const deletions = (from: number, count: number) =>
    Array.from({ length: count }, (_, n) => ({
      path: `${from + n}.md`,
      source: null,
      baseVersion: 1,
    }))

  it('lets a few deletions through and holds back a wipe split across pushes', async () => {
    const few = await pushTo({ writes: deletions(0, 5) })
    expect(few.paused).toBeUndefined()
    expect(few.results.every((result) => result.status === 'ok')).toBe(true)
    const more = await pushTo({
      writes: [...deletions(5, 15), { path: 'new.md', source: '# New\n', baseVersion: 0 }],
    })
    expect(more.paused).toEqual({ deleted: 20, tracked: 40 })
    expect(more.results.filter((result) => result.reason === MASS_DELETION_REASON)).toHaveLength(15)
    expect(more.results.at(-1)).toMatchObject({ path: 'new.md', status: 'ok' })
    expect(await clocked.get('5.md')).not.toBeNull()
  })

  it('deletes after the user confirms', async () => {
    await pushTo({ writes: deletions(0, 5) })
    const confirmed = await pushTo({ writes: deletions(5, 15), confirmDeletions: true })
    expect(confirmed.paused).toBeUndefined()
    expect(await clocked.get('5.md')).toBeNull()
  })
})

describe('sync history and trash', () => {
  it('lists a deleted note in the trash and serves its text', async () => {
    await push([{ path: 'n.md', source: '# N\n', baseVersion: 0 }])
    await push([{ path: 'n.md', source: null, baseVersion: 1 }])
    const trash = (await (
      await handleSync(new Request('https://kore.example/sync/trash'), store)
    ).json()) as { notes: { id: number; path: string }[] }
    expect(trash.notes.map((note) => note.path)).toEqual(['n.md'])
    const kept = (await (
      await handleSync(
        new Request(`https://kore.example/sync/version?id=${trash.notes[0]?.id}`),
        store,
      )
    ).json()) as { source: string }
    expect(kept.source).toBe('# N\n')
    const history = await handleSync(
      new Request('https://kore.example/sync/history?path=n.md'),
      store,
    )
    expect(((await history.json()) as { versions: unknown[] }).versions).toHaveLength(1)
    expect(
      (await handleSync(new Request('https://kore.example/sync/history?path=.git/x'), store))
        .status,
    ).toBe(400)
    expect(
      (await handleSync(new Request('https://kore.example/sync/version?id=999'), store)).status,
    ).toBe(404)
  })
})
