import { beforeEach, describe, expect, it } from 'vitest'
import { fakeD1 } from './d1-fake'
import { NoteStore } from './store'
import { MAX_PUSH_WRITES, MAX_UNPARSED_PUSH_WRITES, handleSync } from './sync'

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
