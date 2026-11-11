import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DEFAULT_VAULT_LAYOUT } from '@reflect/core/graph/vault-layout'
import { describe, expect, it } from 'vitest'
import type { Fetch } from './cloudflare'
import { KoreCloud, PUSH_BATCH, readVaultLayout, readVaultNotes, uploadNotes } from './upload'

interface Pushed {
  path: string
  source: string
  baseVersion: number
  meta?: { title: string; tags: string[]; text: string }
}

/** A stand-in for the Worker's `/sync/*`: notes by path, versions, the owner key. */
function fakeWorker(initial: Record<string, string> = {}) {
  const notes = new Map<string, { source: string; version: number; seq: number }>()
  let seq = 0
  for (const [path, source] of Object.entries(initial)) {
    seq += 1
    notes.set(path, { source, version: 1, seq })
  }
  const pushes: Pushed[][] = []
  const fetcher: Fetch = async (input, init) => {
    const url = new URL(input)
    if (new Headers(init?.headers).get('authorization') !== 'Bearer owner') {
      return new Response('{}', { status: 401 })
    }
    if (url.pathname === '/sync/changes') {
      const since = Number(url.searchParams.get('since'))
      const limit = Number(url.searchParams.get('limit'))
      const page = [...notes]
        .filter(([, note]) => note.seq > since)
        .sort(([, left], [, right]) => left.seq - right.seq)
        .slice(0, limit)
        .map(([path, note]) => ({ path, ...note }))
      return Response.json({
        changes: page,
        cursor: page.at(-1)?.seq ?? since,
        more: page.length === limit,
      })
    }
    const { writes } = JSON.parse(init?.body as string) as { writes: Pushed[] }
    pushes.push(writes)
    return Response.json({
      results: writes.map((write) => {
        const current = notes.get(write.path)
        if ((current?.version ?? 0) !== write.baseVersion) {
          return { path: write.path, status: 'conflict' }
        }
        seq += 1
        notes.set(write.path, { source: write.source, version: write.baseVersion + 1, seq })
        return { path: write.path, status: 'ok' }
      }),
    })
  }
  return {
    cloud: new KoreCloud('https://kore.example.workers.dev/', 'owner', fetcher),
    notes,
    pushes,
  }
}

async function vaultWith(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kore-cloud-vault-'))
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), content)
  }
  return root
}

describe('first upload', () => {
  it('reads every note outside hidden folders', async () => {
    const vault = await vaultWith({
      'Inbox.md': '# Inbox',
      'Projects/Kore/Kore.md': '# Kore',
      '.obsidian/workspace.md': 'not a note',
      '.git/HEAD.md': 'not a note',
      'image.png': 'binary',
    })
    const notes = await readVaultNotes(vault)
    expect(notes.map((note) => note.path)).toEqual(['Inbox.md', 'Projects/Kore/Kore.md'])
  })

  it('takes the layout from .obsidian, or Kore default without it', async () => {
    const obsidian = await vaultWith({
      '.obsidian/daily-notes.json': JSON.stringify({ folder: 'Journal', format: 'YYYY-MM-DD' }),
    })
    expect((await readVaultLayout(obsidian)).dailyFolder).toBe('Journal')
    expect(await readVaultLayout(await vaultWith({}))).toEqual(DEFAULT_VAULT_LAYOUT)
  })

  it('sends only what Kore Cloud lacks, with meta, and never overwrites', async () => {
    const { cloud, notes, pushes } = fakeWorker({
      'Same.md': '# Same',
      'Edited.md': '# Edited by Claude',
    })
    const report = await uploadNotes(cloud, [
      { path: 'Same.md', source: '# Same' },
      { path: 'Edited.md', source: '# Edited on the Mac' },
      { path: 'New.md', source: '# New\n\nHello #idea' },
      { path: 'Secret.md', source: '---\nprivate: true\n---\n# Secret' },
      { path: 'Huge.md', source: 'x'.repeat(1_000_001) },
    ])
    expect(report).toEqual({
      uploaded: 1,
      unchanged: 1,
      differs: ['Edited.md'],
      private: 1,
      tooLarge: ['Huge.md'],
      failed: [],
    })
    expect(notes.get('Edited.md')?.source).toBe('# Edited by Claude')
    expect(notes.has('Secret.md')).toBe(false)
    expect(pushes).toEqual([
      [
        {
          path: 'New.md',
          source: '# New\n\nHello #idea',
          baseVersion: 0,
          meta: { title: 'New', tags: ['idea'], text: expect.stringContaining('Hello') },
        },
      ],
    ])
  })

  it('splits a large vault into pushes the Worker accepts', async () => {
    const { cloud, pushes } = fakeWorker()
    const local = Array.from({ length: PUSH_BATCH * 2 + 3 }, (_, index) => ({
      path: `Note ${index}.md`,
      source: `# Note ${index}`,
    }))
    const report = await uploadNotes(cloud, local)
    expect(report.uploaded).toBe(local.length)
    expect(pushes.map((push) => push.length)).toEqual([PUSH_BATCH, PUSH_BATCH, 3])
    // A second run finds everything already there.
    const again = await uploadNotes(cloud, local)
    expect(again.uploaded).toBe(0)
    expect(again.unchanged).toBe(local.length)
  })

  it('reports a note that lost a race instead of overwriting it', async () => {
    const { cloud, notes } = fakeWorker()
    const original = cloud.push.bind(cloud)
    cloud.push = async (writes) => {
      notes.set('Race.md', { source: '# Written by an agent first', version: 1, seq: 99 })
      return await original(writes)
    }
    const report = await uploadNotes(cloud, [{ path: 'Race.md', source: '# Mine' }])
    expect(report.failed).toEqual([
      { path: 'Race.md', reason: 'changed in Kore Cloud during the upload' },
    ])
    expect(notes.get('Race.md')?.source).toBe('# Written by an agent first')
  })
})
