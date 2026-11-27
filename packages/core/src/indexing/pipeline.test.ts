import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setBridge } from '../ipc/bridge'
import { getBacklinks, resolveWikiTarget } from './queries'
import { searchNotes } from './filtered-search'
import { hashContent } from './hash'
import { PROJECTION_VERSION, PROJECTION_VERSION_KEY } from './indexed-note'
import { REPROJECT_CHECKPOINT_EVERY, REPROJECT_CHECKPOINT_KEY } from './reproject-checkpoint'
import {
  indexNote,
  rebuildIndex,
  reconcileIndex,
  reindexNotesReferencing,
  syncIndex,
} from './indexer'
import { subscribeIndexApplied } from './index-applied'
import { applyIndexChanges } from './live'

// Install a fake bridge so both core's `call` and the Kysely runner resolve
// against an in-test fake — exercises the pipeline + the Kysely→db_query bridge.
const mockInvoke = vi.fn<(command: string, args: Record<string, unknown>) => Promise<unknown>>()
setBridge({ invoke: mockInvoke, listen: async () => () => {} })

/** What the stored `index_meta` projection stamp reads back as, per test. */
let metaRows: Array<{ value: string }>

beforeEach(() => {
  metaRows = []
  mockInvoke.mockReset()
  mockInvoke.mockImplementation(async (command, args) => {
    const sql = String(args['sql'] ?? '')
    switch (command) {
      case 'note_read':
        return '# Hello\n\n[[World]]'
      case 'list_files':
        return [{ path: 'notes/a.md', size: 1, modifiedMs: 5 }]
      case 'index_reconcile_scan':
        // Mirrors the default list_files: one arrival needing a read.
        return {
          total: 1,
          candidates: [{ path: 'notes/a.md', modifiedMs: 5, storedMtime: null, storedHash: null }],
          orphans: [],
          stalePlaceholders: [],
        }
      case 'index_apply':
      case 'index_apply_batch':
      case 'index_clear':
      case 'index_remove':
      case 'index_remove_batch':
      case 'index_meta_set':
        return null
      case 'db_query':
        if (sql.includes('index_meta')) return metaRows
        if (sql.includes('from "assets"')) return [{ note_path: 'notes/a.md' }]
        if (sql.includes('note_keys')) return [{ note_path: 'notes/a.md' }]
        if (sql.includes('search_fts')) {
          return [
            {
              path: 'notes/a.md',
              title: 'A',
              daily_date: null,
              preview: 'Hello',
              mtime: 5,
              is_pinned: 0,
              fts_highlighted_title: 'A',
              snippet: '\u{1}Hello\u{2}',
            },
          ]
        }
        if (sql.includes('backlinks')) {
          return [
            { source_path: 'notes/b.md', target_raw: 'A', alias: null, pos_from: 0, pos_to: 3 },
          ]
        }
        if (sql.includes('"notes"') && sql.includes('title_key')) {
          return [{ path: 'notes/a.md' }]
        }
        return []
      default:
        return null
    }
  })
})

describe('indexNote', () => {
  it('reads, parses, and applies a built index payload with its generation', async () => {
    await indexNote('notes/a.md', { generation: 7, mtime: 5 })
    const apply = mockInvoke.mock.calls.find(([cmd]) => cmd === 'index_apply')
    expect(apply).toBeDefined()
    const args = apply![1] as { note: Record<string, unknown>; generation: number }
    expect(args.generation).toBe(7)
    expect(args.note['path']).toBe('notes/a.md')
    expect(args.note['title']).toBe('Hello')
    expect(args.note['mtime']).toBe(5)
    expect(args.note['fileHash']).toMatch(/^[0-9a-f]{64}$/)
    expect((args.note['links'] as { targetKey: string }[]).map((link) => link.targetKey)).toContain(
      'world',
    )
  })
})

describe('reindexNotesReferencing', () => {
  it('re-applies referencing notes and emits the post-apply signal', async () => {
    const emitted: Array<[readonly { path: string; kind: string }[], number]> = []
    const unsubscribe = subscribeIndexApplied((changes, generation) => {
      emitted.push([changes, generation])
    })
    try {
      await reindexNotesReferencing(['assets/pic.png'], 7)
    } finally {
      unsubscribe()
    }

    const apply = mockInvoke.mock.calls.find(([cmd]) => cmd === 'index_apply')
    expect(apply).toBeDefined()
    expect((apply![1] as { generation: number }).generation).toBe(7)

    // These writes bypass the watcher pipeline, so the emit is the only way
    // followers (the embedding sync) hear about the refreshed notes.
    expect(emitted).toEqual([[[{ path: 'notes/a.md', kind: 'upsert' }], 7]])
  })

  it('still emits the applied prefix when a later note’s re-index throws', async () => {
    mockInvoke.mockImplementation(async (command, args) => {
      const sql = String(args['sql'] ?? '')
      if (command === 'db_query' && sql.includes('from "assets"')) {
        return [{ note_path: 'notes/a.md' }, { note_path: 'notes/b.md' }]
      }
      if (command === 'note_read') {
        if ((args as { path: string }).path === 'notes/b.md') {
          throw { kind: 'io', message: 'disk error' }
        }
        return '# Hello'
      }
      return null
    })
    const emitted: Array<readonly { path: string }[]> = []
    const unsubscribe = subscribeIndexApplied((changes) => {
      emitted.push(changes)
    })
    try {
      await expect(reindexNotesReferencing(['assets/pic.png'], 7)).rejects.toMatchObject({
        kind: 'io',
      })
    } finally {
      unsubscribe()
    }
    // notes/a.md was applied before the failure — followers must hear it.
    expect(emitted).toEqual([[{ path: 'notes/a.md', kind: 'upsert' }]])
  })

  it('emits nothing when no note references the assets', async () => {
    mockInvoke.mockImplementation(async (command, args) => {
      const sql = String(args['sql'] ?? '')
      if (command === 'db_query' && sql.includes('from "assets"')) {
        return []
      }
      return null
    })
    const emitted: unknown[] = []
    const unsubscribe = subscribeIndexApplied((changes) => {
      emitted.push(changes)
    })
    try {
      await reindexNotesReferencing(['assets/pic.png'], 7)
    } finally {
      unsubscribe()
    }
    expect(emitted).toEqual([])
  })
})

describe('rebuildIndex', () => {
  it('clears, lists, applies every file in one batch, then stamps the projection version', async () => {
    const progress: Array<[number, number, number]> = []
    await rebuildIndex({
      generation: 1,
      onFileProgress: (done, total, worked) => {
        progress.push([done, total, worked])
      },
    })
    // A rebuild reads everything: worked tracks done, so the pill surfaces.
    expect(progress.at(-1)).toEqual([1, 1, 1])
    const commands = mockInvoke.mock.calls.map(([cmd]) => cmd)
    // The pass unstamps the projection and drops any resume checkpoint
    // before it wipes.
    expect(commands.slice(0, 3)).toEqual(['index_meta_set', 'index_meta_set', 'index_clear'])
    expect(commands).toContain('list_files')
    const batch = mockInvoke.mock.calls.find(([cmd]) => cmd === 'index_apply_batch')
    expect(batch).toBeDefined()
    const notes = (batch![1] as { notes: { path: string }[] }).notes
    expect(notes.map((note) => note.path)).toEqual(['notes/a.md'])
    expect(commands).not.toContain('index_apply') // batched, not one-by-one
    // The stamp lets the next open reconcile instead of rebuilding again. It is
    // the LAST meta write: the pass opens by clearing the stamp.
    const stamp = mockInvoke.mock.calls.findLast(([cmd]) => cmd === 'index_meta_set')
    expect(stamp![1]).toMatchObject({
      key: PROJECTION_VERSION_KEY,
      value: String(PROJECTION_VERSION),
      generation: 1,
    })
  })

  it('splits a failed rebuild batch and still applies the notes individually', async () => {
    mockInvoke.mockImplementation(async (command, args) => {
      if (command === 'list_files') {
        return [
          { path: 'notes/a.md', size: 1, modifiedMs: 1 },
          { path: 'notes/b.md', size: 1, modifiedMs: 2 },
          { path: 'notes/c.md', size: 1, modifiedMs: 3 },
        ]
      }
      if (command === 'note_read') {
        return `# ${String(args['path'])}\n`
      }
      if (command === 'index_apply_batch') {
        const notes = args['notes'] as Array<{ path: string }>
        if (notes.length > 1) {
          throw new Error('batch payload refused')
        }
        return null
      }
      return null
    })

    await rebuildIndex({ generation: 1 })

    const applied = mockInvoke.mock.calls
      .filter(([command]) => command === 'index_apply_batch')
      .map(([, args]) =>
        (args as { notes: Array<{ path: string }> }).notes.map((note) => note.path),
      )
    expect(applied).toEqual([
      ['notes/a.md', 'notes/b.md', 'notes/c.md'],
      ['notes/a.md', 'notes/b.md'],
      ['notes/a.md'],
      ['notes/b.md'],
      ['notes/c.md'],
    ])
    expect(mockInvoke.mock.calls.some(([command]) => command === 'index_meta_set')).toBe(true)
  })

  it('reports and skips a note whose projection cannot be written alone', async () => {
    mockInvoke.mockImplementation(async (command, args) => {
      if (command === 'list_files') {
        return [{ path: 'notes/bad.md', size: 1, modifiedMs: 1 }]
      }
      if (command === 'note_read') {
        return `# ${String(args['path'])}\n`
      }
      if (command === 'index_apply_batch') {
        throw { kind: 'parse', message: 'unexpected end of hex escape' }
      }
      return null
    })
    const skipped: Array<{ path: string; message: string }> = []

    await rebuildIndex({
      generation: 1,
      onSkippedNote: (note) => {
        skipped.push(note)
      },
    })

    expect(skipped).toEqual([{ path: 'notes/bad.md', message: 'unexpected end of hex escape' }])
    expect(
      mockInvoke.mock.calls
        .filter(
          ([command, args]) =>
            command === 'index_meta_set' && args['key'] === PROJECTION_VERSION_KEY,
        )
        .map(([, args]) => args['value']),
    ).toEqual([''])
  })

  it('keeps healthy rows when a read fails, and stamps only after a healthy retry', async () => {
    let unreadable = true
    const original = mockInvoke.getMockImplementation()!
    mockInvoke.mockImplementation(async (command, args) => {
      if (command === 'list_files') {
        return ['before', 'bad', 'after'].map((name) => ({
          path: `notes/${name}.md`,
          size: 1,
          modifiedMs: 1,
        }))
      }
      if (command === 'note_read' && args['path'] === 'notes/bad.md' && unreadable) {
        throw new Error('permission denied')
      }
      return await original(command, args)
    })
    const onSkippedNote = vi.fn()
    await rebuildIndex({ generation: 1, onSkippedNote })
    expect(onSkippedNote).toHaveBeenCalledWith({
      path: 'notes/bad.md',
      message: 'permission denied',
    })
    expect(
      mockInvoke.mock.calls.find(([command]) => command === 'index_apply_batch')?.[1],
    ).toMatchObject({
      notes: [{ path: 'notes/after.md' }, { path: 'notes/before.md' }],
    })
    expect(
      mockInvoke.mock.calls
        .filter(
          ([command, args]) =>
            command === 'index_meta_set' && args['key'] === PROJECTION_VERSION_KEY,
        )
        .map(([, args]) => args['value']),
    ).toEqual([''])

    unreadable = false
    mockInvoke.mockClear()
    await rebuildIndex({ generation: 1, onSkippedNote })
    expect(
      mockInvoke.mock.calls.findLast(([command]) => command === 'index_meta_set')?.[1]['value'],
    ).toBe(String(PROJECTION_VERSION))
    expect(
      mockInvoke.mock.calls.find(([command]) => command === 'index_apply_batch')?.[1],
    ).toMatchObject({
      // The listing is walked in path order (the resume checkpoint needs it).
      notes: [{ path: 'notes/after.md' }, { path: 'notes/bad.md' }, { path: 'notes/before.md' }],
    })
  })

  it('throws a single-note write failure when no skip callback is registered', async () => {
    mockInvoke.mockImplementation(async (command, args) => {
      if (command === 'list_files') {
        return [{ path: 'notes/bad.md', size: 1, modifiedMs: 1 }]
      }
      if (command === 'note_read') {
        return `# ${String(args['path'])}\n`
      }
      if (command === 'index_apply_batch') {
        throw new Error('single note refused')
      }
      return null
    })

    await expect(rebuildIndex({ generation: 1 })).rejects.toThrow('single note refused')
    // The pass unstamped on the way in, so a meta write did happen. What must
    // not happen is a write claiming the projection is current: a failed
    // rebuild has to leave the index honestly marked stale.
    const stamped = mockInvoke.mock.calls.filter(
      ([command, args]) => command === 'index_meta_set' && (args as { value: string }).value !== '',
    )
    expect(stamped).toEqual([])
  })

  it('stops before the next SQLite write when suspended after the rebuild wipe', async () => {
    const controller = new AbortController()
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'list_files') {
        return [{ path: 'notes/a.md', size: 1, modifiedMs: 1 }]
      }
      if (command === 'note_read') {
        // Models iOS becoming hidden while filesystem work is in flight.
        controller.abort()
        return '# A\n'
      }
      return null
    })

    await rebuildIndex({ generation: 1, signal: controller.signal })

    const commands = mockInvoke.mock.calls.map(([command]) => command)
    expect(commands).toContain('index_clear') // began while foregrounded
    expect(commands).not.toContain('index_apply_batch')
    // No stamp claiming the projection is current is written: the pass cleared
    // the stamp on the way in and never restored it, so the interrupted index
    // reads as stale and the next foreground pass rebuilds rather than
    // reconciling into a hole.
    const stamped = mockInvoke.mock.calls.filter(
      ([command, args]) => command === 'index_meta_set' && (args as { value: string }).value !== '',
    )
    expect(stamped).toEqual([])
  })
})

describe('syncIndex', () => {
  it('reconciles (no wipe) when the stored projection version is current', async () => {
    metaRows = [{ value: String(PROJECTION_VERSION) }]
    await syncIndex({ generation: 2 })
    const commands = mockInvoke.mock.calls.map(([cmd]) => cmd)
    expect(commands).toContain('index_reconcile_scan')
    expect(commands).not.toContain('index_clear')
    expect(commands).not.toContain('index_meta_set')
  })

  it('clears the projection stamp before wiping, so a rebuild is visible while it runs', async () => {
    // `syncIndex` reaches a rebuild with an already-stale stamp, so the gate
    // works there by accident. The manual rebuild from Settings and the command
    // palette calls `rebuildIndex` directly with a CURRENT stamp, and every
    // reader gating on `isProjectionCurrent` would otherwise get a green light
    // over a table that is empty, then partial. `listPrivateNotePaths` is one
    // of those readers, and it is the private-note deny list.
    await rebuildIndex({ generation: 4 })
    const order = mockInvoke.mock.calls
      .filter(
        ([cmd, args]) =>
          cmd === 'index_clear' ||
          (cmd === 'index_meta_set' && args['key'] === PROJECTION_VERSION_KEY),
      )
      .map(([cmd, args]) =>
        cmd === 'index_meta_set' ? `meta:${(args as { value: string }).value}` : cmd,
      )
    // Unstamped first, wiped second, restamped last.
    expect(order[0]).toBe('meta:')
    expect(order[1]).toBe('index_clear')
    expect(order.at(-1)).toBe(`meta:${PROJECTION_VERSION}`)
  })

  describe('with rows from an older projection', () => {
    /** Stored rows: one still on disk, one deleted, one evicted to iCloud. */
    function serveOlderIndex(): void {
      metaRows = [{ value: String(PROJECTION_VERSION - 1) }]
      const fallback = mockInvoke.getMockImplementation()!
      mockInvoke.mockImplementation(async (command, args) => {
        if (command === 'list_files') {
          return [
            { path: 'notes/a.md', size: 1, modifiedMs: 5 },
            {
              path: 'notes/evicted.md',
              size: 1,
              modifiedMs: 5,
              placeholder: true,
            },
          ]
        }
        if (command === 'db_query' && String(args['sql']).includes('"file_hash"')) {
          return ['notes/a.md', 'notes/gone.md', 'notes/evicted.md'].map((path) => ({
            path,
            file_hash: 'old',
            mtime: 5,
          }))
        }
        return await fallback(command, args)
      })
    }

    it('re-derives every note over its rows instead of wiping the index', async () => {
      serveOlderIndex()
      await syncIndex({ generation: 3 })
      const commands = mockInvoke.mock.calls.map(([cmd]) => cmd)
      // The old projection keeps answering while the pass runs: no wipe, and
      // the stamp is never cleared on the way in.
      expect(commands).not.toContain('index_clear')
      expect(commands).not.toContain('index_reconcile_scan')
      const applied = mockInvoke.mock.calls.find(([cmd]) => cmd === 'index_apply_batch')
      expect((applied![1] as { notes: { path: string }[] }).notes.map((note) => note.path)).toEqual(
        ['notes/a.md'],
      )
      const stamps = mockInvoke.mock.calls.filter(([cmd]) => cmd === 'index_meta_set')
      expect(stamps.map(([, args]) => (args as { value: string }).value)).toEqual([
        String(PROJECTION_VERSION),
      ])
    })

    it('drops the rows it did not replace: deleted notes and evicted placeholders', async () => {
      serveOlderIndex()
      const onStalePlaceholders = vi.fn()
      await syncIndex({ generation: 3, onStalePlaceholders })
      const removed = mockInvoke.mock.calls
        .filter(([cmd]) => cmd === 'index_remove_batch')
        .flatMap(([, args]) => (args as { paths: string[] }).paths)
      expect(removed.sort()).toEqual(['notes/evicted.md', 'notes/gone.md'])
      // Removals follow the applies, so a reader never sees a note vanish and
      // come back within the pass.
      const commands = mockInvoke.mock.calls.map(([cmd]) => cmd)
      expect(commands.indexOf('index_remove_batch')).toBeGreaterThan(
        commands.indexOf('index_apply_batch'),
      )
      expect(onStalePlaceholders).toHaveBeenCalledWith(['notes/evicted.md'])
    })

    it('leaves the old stamp when aborted, so the next open refreshes again', async () => {
      serveOlderIndex()
      const controller = new AbortController()
      const fallback = mockInvoke.getMockImplementation()!
      mockInvoke.mockImplementation(async (command, args) => {
        if (command === 'note_read') {
          controller.abort()
        }
        return await fallback(command, args)
      })
      await syncIndex({ generation: 3, signal: controller.signal })
      const commands = mockInvoke.mock.calls.map(([cmd]) => cmd)
      expect(commands).not.toContain('index_meta_set')
      expect(commands).not.toContain('index_remove_batch')
    })
  })

  describe('resuming an interrupted pass', () => {
    /** Enough notes for two checkpoints, listed out of order on purpose. */
    const paths = Array.from(
      { length: REPROJECT_CHECKPOINT_EVERY * 2 + 10 },
      (_, index) => `notes/${String(index).padStart(4, '0')}.md`,
    )

    /**
     * A stateful `index_meta` and a listing of {@link paths}; `onRead` sees
     * every note read so a test can interrupt the pass partway.
     */
    function serveVault(
      initialMeta: Record<string, string>,
      onRead?: (path: string) => void,
      placeholders: ReadonlySet<string> = new Set(),
    ) {
      const meta = new Map(Object.entries(initialMeta))
      const reads: string[] = []
      const fallback = mockInvoke.getMockImplementation()!
      mockInvoke.mockImplementation(async (command, args) => {
        if (command === 'list_files') {
          return [...paths].reverse().map((path) => ({
            path,
            size: 1,
            modifiedMs: 5,
            ...(placeholders.has(path) ? { placeholder: true } : {}),
          }))
        }
        if (command === 'note_read') {
          const path = String(args['path'])
          reads.push(path)
          onRead?.(path)
          return `# ${path}\n`
        }
        if (command === 'index_meta_set') {
          meta.set(String(args['key']), String(args['value']))
          return null
        }
        if (command === 'index_reconcile_scan') {
          return { total: paths.length, candidates: [], orphans: [], stalePlaceholders: [] }
        }
        if (command === 'db_query' && String(args['sql']).includes('index_meta')) {
          const value = meta.get(String((args['params'] as unknown[])[0]))
          return value === undefined ? [] : [{ value }]
        }
        if (command === 'db_query' && String(args['sql']).includes('"file_hash"')) {
          return paths.map((path) => ({ path, file_hash: 'old', mtime: 5 }))
        }
        return await fallback(command, args)
      })
      return { meta, reads }
    }

    it('continues after the last checkpoint instead of re-reading the whole vault', async () => {
      const older = { [PROJECTION_VERSION_KEY]: String(PROJECTION_VERSION - 1) }
      const controller = new AbortController()
      // iOS suspends the app partway through the third stretch of notes.
      const cut = paths[REPROJECT_CHECKPOINT_EVERY * 2 + 3]!
      const first = serveVault(older, (path) => {
        if (path === cut) controller.abort()
      })
      await syncIndex({ generation: 3, signal: controller.signal })

      expect(first.meta.get(PROJECTION_VERSION_KEY)).toBe(String(PROJECTION_VERSION - 1))
      const checkpoint = JSON.parse(first.meta.get(REPROJECT_CHECKPOINT_KEY)!)
      expect(checkpoint).toEqual({
        stamp: String(PROJECTION_VERSION),
        after: paths[REPROJECT_CHECKPOINT_EVERY * 2 - 1],
        evicted: [],
      })

      mockInvoke.mockClear()
      const progress: Array<[number, number, number, boolean]> = []
      const second = serveVault(Object.fromEntries(first.meta))
      await syncIndex({
        generation: 4,
        onFileProgress: (...args) => {
          progress.push(args)
        },
      })

      // Only the notes after the checkpoint are read again.
      expect(second.reads).toEqual(paths.slice(REPROJECT_CHECKPOINT_EVERY * 2))
      expect(second.meta.get(PROJECTION_VERSION_KEY)).toBe(String(PROJECTION_VERSION))
      expect(second.meta.get(REPROJECT_CHECKPOINT_KEY)).toBe('')
      // The skipped prefix is checked by a reconcile, which reads only what
      // changed there while the app was closed.
      const commands = mockInvoke.mock.calls.map(([cmd]) => cmd)
      expect(commands).toContain('index_reconcile_scan')
      // The previous rows kept answering throughout: nothing to announce.
      expect(progress).toContainEqual([paths.length, paths.length, 10, false])
      expect(progress.every(([, , , fromEmpty]) => !fromEmpty)).toBe(true)
      // Rows of the prefix are kept, not dropped as unlisted.
      expect(commands).not.toContain('index_remove_batch')
    })

    it('reads a prefix note on resume that was an evicted placeholder before', async () => {
      const evicted = paths[10]!
      const older = { [PROJECTION_VERSION_KEY]: String(PROJECTION_VERSION - 1) }
      const controller = new AbortController()
      const cut = paths[REPROJECT_CHECKPOINT_EVERY + 3]!
      const first = serveVault(
        older,
        (path) => {
          if (path === cut) controller.abort()
        },
        new Set([evicted]),
      )
      await syncIndex({ generation: 3, signal: controller.signal })
      expect(JSON.parse(first.meta.get(REPROJECT_CHECKPOINT_KEY)!)).toMatchObject({
        evicted: [evicted],
      })

      // It has materialized since: its old row must not survive the resume.
      const second = serveVault(Object.fromEntries(first.meta))
      await syncIndex({ generation: 4 })
      // The first checkpoint lands after 256 *read* notes, one past index 255
      // because the placeholder was not read.
      expect(second.reads).toEqual([evicted, ...paths.slice(REPROJECT_CHECKPOINT_EVERY + 1)])
    })

    it('never rewinds the checkpoint while re-reading prefix placeholders', async () => {
      const after = paths[REPROJECT_CHECKPOINT_EVERY + 5]!
      const evicted = paths.slice(0, REPROJECT_CHECKPOINT_EVERY + 1)
      const writes: string[] = []
      const { meta } = serveVault({
        [PROJECTION_VERSION_KEY]: String(PROJECTION_VERSION - 1),
        [REPROJECT_CHECKPOINT_KEY]: JSON.stringify({
          stamp: String(PROJECTION_VERSION),
          after,
          evicted,
        }),
      })
      const fallback = mockInvoke.getMockImplementation()!
      mockInvoke.mockImplementation(async (command, args) => {
        if (command === 'index_meta_set' && args['key'] === REPROJECT_CHECKPOINT_KEY) {
          writes.push(String(args['value']))
        }
        return await fallback(command, args)
      })
      await syncIndex({ generation: 4 })
      // Every checkpoint written lies beyond the resumed one.
      const written = writes
        .filter((write) => write !== '')
        .map((write) => (JSON.parse(write) as { after: string }).after)
      expect(written.every((path) => path > after)).toBe(true)
      expect(meta.get(PROJECTION_VERSION_KEY)).toBe(String(PROJECTION_VERSION))
    })

    it('ignores a checkpoint written for another projection', async () => {
      const { reads, meta } = serveVault({
        [PROJECTION_VERSION_KEY]: String(PROJECTION_VERSION - 1),
        [REPROJECT_CHECKPOINT_KEY]: JSON.stringify({
          stamp: String(PROJECTION_VERSION - 1),
          after: paths[100],
        }),
      })
      await syncIndex({ generation: 3 })
      expect(reads).toEqual(paths)
      expect(meta.get(PROJECTION_VERSION_KEY)).toBe(String(PROJECTION_VERSION))
    })

    it('reports a first index as filling from empty, so the pill can show', async () => {
      serveVault({})
      const fromEmpty: boolean[] = []
      await syncIndex({
        generation: 3,
        onFileProgress: (_done, _total, _worked, empty) => {
          fromEmpty.push(empty)
        },
      })
      expect(new Set(fromEmpty)).toEqual(new Set([true]))
    })

    it('a manual rebuild drops the checkpoint before it wipes', async () => {
      const { meta } = serveVault({
        [PROJECTION_VERSION_KEY]: String(PROJECTION_VERSION),
        [REPROJECT_CHECKPOINT_KEY]: JSON.stringify({
          stamp: String(PROJECTION_VERSION),
          after: paths[100],
        }),
      })
      const controller = new AbortController()
      mockInvoke.mockClear()
      const fallback = mockInvoke.getMockImplementation()!
      mockInvoke.mockImplementation(async (command, args) => {
        if (command === 'index_clear') controller.abort()
        return await fallback(command, args)
      })
      await rebuildIndex({ generation: 3, signal: controller.signal })
      expect(meta.get(REPROJECT_CHECKPOINT_KEY)).toBe('')
    })
  })

  it('runs the tag inheritance pass once at the end, so a failed earlier pass heals', async () => {
    metaRows = [{ value: String(PROJECTION_VERSION) }]
    const fallback = mockInvoke.getMockImplementation()!
    mockInvoke.mockImplementation(async (command, args) => {
      if (command === 'index_tag_types_resolve') {
        return null
      }
      if (command === 'db_query' && String(args['sql']).includes('"tag_types"."schema_json"')) {
        return [{ tag_key: 'contact', schema_json: '[]', is_private: 0 }]
      }
      return await fallback(command, args)
    })
    await syncIndex({ generation: 2 })
    const commands = mockInvoke.mock.calls.map(([cmd]) => cmd)
    expect(commands.filter((cmd) => cmd === 'index_tag_types_resolve')).toHaveLength(1)
    expect(commands.at(-1)).toBe('index_tag_types_resolve')
  })

  it('rebuilds and stamps when the index predates the current projection', async () => {
    metaRows = [] // never stamped (or written by an older app)
    await syncIndex({ generation: 3 })
    const commands = mockInvoke.mock.calls.map(([cmd]) => cmd)
    expect(commands).toContain('index_clear')
    const stamp = mockInvoke.mock.calls.findLast(([cmd]) => cmd === 'index_meta_set')
    expect(stamp![1]).toMatchObject({
      key: PROJECTION_VERSION_KEY,
      value: String(PROJECTION_VERSION),
      generation: 3,
    })
  })
})

describe('applyIndexChanges (watcher dispatch)', () => {
  it('re-indexes upserts (batched) and removes deletes at the given generation', async () => {
    const { mutations } = await applyIndexChanges(
      [
        { path: 'notes/a.md', kind: 'upsert', modifiedMs: 4242 },
        { path: 'notes/gone.md', kind: 'remove' },
      ],
      9,
    )
    const apply = mockInvoke.mock.calls.find(([cmd]) => cmd === 'index_apply_batch')
    const remove = mockInvoke.mock.calls.find(([cmd]) => cmd === 'index_remove_batch')
    const args = apply![1] as { notes: Array<{ path: string; mtime: number }>; generation: number }
    expect(args.generation).toBe(9)
    expect(args.notes.map((note) => note.path)).toEqual(['notes/a.md'])
    expect(args.notes[0]!.mtime).toBe(4242)
    expect(remove![1]).toMatchObject({ paths: ['notes/gone.md'], generation: 9 })
    expect(mutations).toBe(2)
  })

  it('stamps "now" — never epoch zero — when an upsert carries no modifiedMs', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_750_000_000_000)
    try {
      await applyIndexChanges([{ path: 'notes/a.md', kind: 'upsert' }], 9)
      const apply = mockInvoke.mock.calls.find(([cmd]) => cmd === 'index_apply_batch')
      const notes = (apply![1] as { notes: Array<{ mtime: number }> }).notes
      expect(notes[0]!.mtime).toBe(1_750_000_000_000)
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('skips upserts whose indexed row already matches an old mtime, without reading', async () => {
    // The iCloud watch's initial gather re-reports every downloaded note; a
    // row indexed at the same (settled) mtime must cost neither a read nor a
    // write — and a zero-mutation batch reports 0 so no invalidation fires.
    mockInvoke.mockImplementation(async (command, args) => {
      const sql = String(args['sql'] ?? '')
      if (command === 'db_query' && sql.includes('file_hash')) {
        return [{ path: 'notes/a.md', file_hash: 'stored', mtime: 1_000 }]
      }
      if (command === 'db_query') {
        return []
      }
      if (command === 'note_read') {
        throw new Error('must not read an mtime-matched file')
      }
      return null
    })

    const { mutations } = await applyIndexChanges(
      [{ path: 'notes/a.md', kind: 'upsert', modifiedMs: 1_000 }],
      9,
    )

    expect(mutations).toBe(0)
    const commands = mockInvoke.mock.calls.map(([cmd]) => cmd)
    expect(commands).not.toContain('note_read')
    expect(commands).not.toContain('index_apply_batch')
    expect(commands).not.toContain('index_touch')
  })

  it('re-stamps the stored mtime when content is unchanged but the mtime moved', async () => {
    const content = '# same content\n'
    mockInvoke.mockImplementation(async (command, args) => {
      const sql = String(args['sql'] ?? '')
      if (command === 'db_query' && sql.includes('file_hash')) {
        return [{ path: 'notes/a.md', file_hash: await hashContent(content), mtime: 1_000 }]
      }
      if (command === 'db_query') {
        return []
      }
      if (command === 'note_read') {
        return content
      }
      return null
    })

    const { mutations } = await applyIndexChanges(
      [{ path: 'notes/a.md', kind: 'upsert', modifiedMs: 2_000 }],
      9,
    )

    // The re-stamp counts as a mutation: `updated_at` moved, so
    // recency-ordered queries must be invalidated.
    expect(mutations).toBe(1)
    const touch = mockInvoke.mock.calls.find(([cmd]) => cmd === 'index_touch')
    expect(touch![1]).toEqual({
      entries: [{ path: 'notes/a.md', mtime: 2_000 }],
      generation: 9,
    })
    expect(mockInvoke.mock.calls.map(([cmd]) => cmd)).not.toContain('index_apply_batch')
  })

  it('still reads when the reported mtime is too fresh to trust', async () => {
    // Local write echoes stamp rows with Date.now(): two same-millisecond
    // saves would look "unchanged" by mtime alone, so fresh mtimes always
    // take the read-and-hash path.
    const now = 1_750_000_000_000
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now)
    try {
      mockInvoke.mockImplementation(async (command, args) => {
        const sql = String(args['sql'] ?? '')
        if (command === 'db_query' && sql.includes('file_hash')) {
          return [{ path: 'notes/a.md', file_hash: 'stale', mtime: now - 10 }]
        }
        if (command === 'db_query') {
          return []
        }
        if (command === 'note_read') {
          return '# fresh content'
        }
        return null
      })

      const { mutations } = await applyIndexChanges(
        [{ path: 'notes/a.md', kind: 'upsert', modifiedMs: now - 10 }],
        9,
      )

      expect(mutations).toBe(1)
      const commands = mockInvoke.mock.calls.map(([cmd]) => cmd)
      expect(commands).toContain('note_read')
      expect(commands).toContain('index_apply_batch')
    } finally {
      nowSpy.mockRestore()
    }
  })

  describe('tagsChanged', () => {
    /** One stored note `notes/a.md` carrying member tag `book`, read back as `content`. */
    function storedBookNote(content: string): void {
      mockInvoke.mockImplementation(async (command, args) => {
        const sql = String(args['sql'] ?? '')
        if (command === 'db_query' && sql.includes('file_hash')) {
          return [{ path: 'notes/a.md', file_hash: 'stored', mtime: 1_000 }]
        }
        if (command === 'db_query' && sql.includes('"member"')) {
          return [{ note_path: 'notes/a.md', tag: 'book', tag_key: 'book', is_private: 0 }]
        }
        if (command === 'db_query') {
          return []
        }
        if (command === 'note_read') {
          return content
        }
        return null
      })
    }

    it('is false for a body edit that keeps the member tags', async () => {
      storedBookNote('---\ntags: [book]\n---\n# A\n\nnew body text')
      const result = await applyIndexChanges(
        [{ path: 'notes/a.md', kind: 'upsert', modifiedMs: 2_000 }],
        9,
      )
      expect(result).toEqual({ mutations: 1, tagsChanged: false })
    })

    it('is true when the save adds a member tag', async () => {
      storedBookNote('---\ntags: [book, film]\n---\n# A\n\nbody')
      const result = await applyIndexChanges(
        [{ path: 'notes/a.md', kind: 'upsert', modifiedMs: 2_000 }],
        9,
      )
      expect(result.tagsChanged).toBe(true)
    })

    it('is true when the save makes a tagged note private', async () => {
      storedBookNote('---\ntags: [book]\nprivate: true\n---\n# A\n\nbody')
      const result = await applyIndexChanges(
        [{ path: 'notes/a.md', kind: 'upsert', modifiedMs: 2_000 }],
        9,
      )
      expect(result.tagsChanged).toBe(true)
    })

    it('is true for a removal', async () => {
      const result = await applyIndexChanges([{ path: 'notes/gone.md', kind: 'remove' }], 9)
      expect(result.tagsChanged).toBe(true)
    })
  })
})

describe('Kysely → db_query bridge', () => {
  it('searchNotes compiles an FTS MATCH query', async () => {
    const hits = await searchNotes('hello')
    const query = mockInvoke.mock.calls.find(([cmd]) => cmd === 'db_query')
    const sql = (query![1] as { sql: string }).sql
    expect(sql).toContain('search_fts')
    expect(sql.toLowerCase()).toContain('match')
    expect(hits).toEqual([{ path: 'notes/a.md', title: 'A' }])
  })

  it('searchNotes returns [] for a blank query without touching the DB', async () => {
    const before = mockInvoke.mock.calls.length
    expect(await searchNotes('   ')).toEqual([])
    expect(mockInvoke.mock.calls.length).toBe(before)
  })

  it('searchNotes runs the palette ranked query (title match, bm25, pinned, recency)', async () => {
    await searchNotes('hello')
    const query = mockInvoke.mock.calls.find(([cmd]) => cmd === 'db_query')
    const sql = (query![1] as { sql: string }).sql.toLowerCase()
    // searchNotes delegates to `searchWithFilters`, so it emits the palette's
    // ranked query verbatim — one search path, orderings can't drift.
    expect(sql).toContain('with "lexical" as materialized')
    expect(sql).toContain('left join "lexical"')
    expect(sql).toContain('when "filtered_notes"."title_key" =')
    expect(sql).toContain(`instr(' ' || "filtered_notes"."title_key"`)
    expect(sql).toContain('bm25(search_fts, 0, 10.0, 1.0)')
    expect(sql).toContain('"filtered_notes"."is_pinned" desc')
    expect(sql).toContain('"filtered_notes"."mtime" desc')
    expect(sql).toContain('"filtered_notes"."path" asc')
  })

  it('getBacklinks maps snake_case rows back to camelCase', async () => {
    const backlinks = await getBacklinks('notes/a.md')
    expect(backlinks).toEqual([
      { sourcePath: 'notes/b.md', targetRaw: 'A', alias: null, posFrom: 0, posTo: 3 },
    ])
  })

  it('resolveWikiTarget resolves a title match to a note ref', async () => {
    expect(await resolveWikiTarget('World')).toEqual({ kind: 'resolved', ref: 'notes/a.md' })
  })
})

describe('reconcileIndex move healing (Plan 17)', () => {
  const OLD = 'notes/01arz3ndektsv4rrffq69g5fav.md'
  const NEW = 'notes/meeting-notes.md'
  const CONTENT = '---\nid: 01abcdefghjkmnpqrstvwxyz00\n---\n# Meeting Notes\n'

  /** A graph where OLD's row remains but the file now lives at NEW. */
  function renameFake(options: { storedHash: string; content?: string }) {
    const calls: Array<[string, Record<string, unknown>]> = []
    mockInvoke.mockImplementation(async (command, args) => {
      calls.push([command, args])
      if (command === 'index_reconcile_scan') {
        return {
          total: 1,
          candidates: [{ path: NEW, modifiedMs: 9, storedMtime: null, storedHash: null }],
          orphans: [{ path: OLD, storedMtime: 1, storedHash: options.storedHash }],
          stalePlaceholders: [],
        }
      }
      if (command === 'note_read') {
        if (args['path'] === NEW) {
          return options.content ?? CONTENT
        }
        throw { kind: 'notFound', message: 'missing' }
      }
      if (command === 'db_query') {
        if (((args['params'] as unknown[]) ?? []).includes(OLD)) {
          return [{ path: OLD, id: '01abcdefghjkmnpqrstvwxyz00' }]
        }
        return []
      }
      return null
    })
    return calls
  }

  it('moves the rows and re-indexes the destination so path-derived claims stay correct', async () => {
    const calls = renameFake({ storedHash: await hashContent(CONTENT) })

    await reconcileIndex({ generation: 4 })

    const commands = calls.map(([command]) => command)
    expect(commands).toContain('index_move')
    const move = calls.find(([command]) => command === 'index_move')
    expect(move?.[1]).toEqual({
      from: OLD,
      to: NEW,
      generation: 4,
      toAddress: { pathKey: NEW.toLowerCase(), basenameKey: 'meeting-notes', dailyDate: null },
    })
    // Re-apply even when the file hash is unchanged: kind/daily_date are
    // path-derived and would otherwise stay stale after a notes/↔daily/ move.
    expect(commands).toContain('index_apply_batch')
    expect(commands).not.toContain('index_remove')
    expect(commands).not.toContain('index_remove_batch')
    const apply = calls.find(([command]) => command === 'index_apply_batch')
    const notes = apply![1]['notes'] as Array<{ path: string }>
    expect(notes.map((note) => note.path)).toEqual([NEW])
  })

  it('re-indexes a notes→daily heal so kind and daily_date follow the new path', async () => {
    const dailyPath = 'daily/2026-08-21.md'
    const content = CONTENT
    const calls: Array<[string, Record<string, unknown>]> = []
    mockInvoke.mockImplementation(async (command, args) => {
      calls.push([command, args])
      if (command === 'index_reconcile_scan') {
        return {
          total: 1,
          candidates: [{ path: dailyPath, modifiedMs: 9, storedMtime: null, storedHash: null }],
          orphans: [{ path: OLD, storedMtime: 1, storedHash: await hashContent(content) }],
          stalePlaceholders: [],
        }
      }
      if (command === 'note_read') {
        if (args['path'] === dailyPath) {
          return content
        }
        throw { kind: 'notFound', message: 'missing' }
      }
      if (command === 'db_query') {
        if (((args['params'] as unknown[]) ?? []).includes(OLD)) {
          return [{ path: OLD, id: '01abcdefghjkmnpqrstvwxyz00' }]
        }
        return []
      }
      return null
    })

    await reconcileIndex({ generation: 4 })

    const apply = calls.find(([command]) => command === 'index_apply_batch')
    const notes = apply![1]['notes'] as Array<{
      path: string
      kind: string
      dailyDate: string | null
    }>
    expect(notes).toEqual([
      expect.objectContaining({ path: dailyPath, kind: 'daily', dailyDate: '2026-08-21' }),
    ])
  })

  it('announces the heal via onMoved so the app can follow', async () => {
    renameFake({ storedHash: await hashContent(CONTENT) })
    const moves: Array<[string, string]> = []

    await reconcileIndex({
      generation: 4,
      onMoved: (from, to) => {
        moves.push([from, to])
      },
    })

    expect(moves).toEqual([[OLD, NEW]])
  })

  it('re-indexes at the new path when content changed in transit', async () => {
    const calls = renameFake({ storedHash: 'stale-hash-from-before-the-edit' })

    await reconcileIndex({ generation: 4 })

    const commands = calls.map(([command]) => command)
    expect(commands).toContain('index_move')
    expect(commands).not.toContain('index_remove')
    expect(commands).not.toContain('index_remove_batch')
    const apply = calls.find(([command]) => command === 'index_apply_batch')
    expect(apply).toBeDefined()
    const notes = apply![1]['notes'] as Array<{ path: string }>
    expect(notes.map((note) => note.path)).toEqual([NEW])
  })

  it('a legacy file without an id still reconciles as delete+create', async () => {
    const calls = renameFake({
      storedHash: 'whatever',
      content: '# Meeting Notes\n',
    })

    await reconcileIndex({ generation: 4 })

    const commands = calls.map(([command]) => command)
    expect(commands).not.toContain('index_move')
    expect(commands).toContain('index_apply_batch')
    expect(commands).toContain('index_remove_batch')
  })
})

describe('reconcileIndex over the native scan delta', () => {
  it('does nothing when the scan reports no delta — the healthy-open path', async () => {
    // Mtime-matched files never leave Rust (the scan's own tests cover the
    // classification); an empty delta must cost no reads, no writes, and no
    // visible progress.
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'index_reconcile_scan') {
        return { total: 7_000, candidates: [], orphans: [], stalePlaceholders: [] }
      }
      if (command === 'note_read') {
        throw new Error('must not read without a candidate')
      }
      if (command === 'db_query') {
        return []
      }
      return null
    })
    const progress: Array<[number, number, number]> = []

    await reconcileIndex({
      generation: 4,
      onFileProgress: (done, total, worked) => {
        progress.push([done, total, worked])
      },
    })

    const commands = mockInvoke.mock.calls.map(([cmd]) => cmd)
    expect(commands).toEqual(['index_reconcile_scan'])
    // Zero worked files, and the total is the delta (0), not the graph size —
    // the pill stays hidden on every routine open.
    expect(progress).toEqual([[0, 0, 0]])
  })

  it('reads (and hash-skips) a candidate whose stored mtime differs — providers rewrite mtimes', async () => {
    const content = '# Hello\n'
    const storedHash = await hashContent(content)
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'index_reconcile_scan') {
        return {
          total: 1,
          candidates: [{ path: 'notes/a.md', modifiedMs: 2_000, storedMtime: 1_000, storedHash }],
          orphans: [],
          stalePlaceholders: [],
        }
      }
      if (command === 'note_read') {
        return content
      }
      if (command === 'db_query') {
        return []
      }
      return null
    })

    const progress: Array<[number, number, number]> = []

    await reconcileIndex({
      generation: 4,
      onFileProgress: (done, total, worked) => {
        progress.push([done, total, worked])
      },
    })

    const commands = mockInvoke.mock.calls.map(([cmd]) => cmd)
    expect(commands).toContain('note_read')
    // Identical content under a rewritten mtime: the hash still gates the write.
    expect(commands).not.toContain('index_apply_batch')
    // The self-heal: the row is re-stamped with the listed mtime, so the next
    // scan skips it entirely instead of re-reading forever.
    const touch = mockInvoke.mock.calls.find(([cmd]) => cmd === 'index_touch')
    expect(touch![1]).toEqual({
      entries: [{ path: 'notes/a.md', mtime: 2_000 }],
      generation: 4,
    })
    // The read counts as worked even though nothing was re-applied.
    expect(progress.at(-1)).toEqual([1, 1, 1])
  })

  it('re-indexes changed candidates and drops orphans', async () => {
    mockInvoke.mockImplementation(async (command, args) => {
      if (command === 'index_reconcile_scan') {
        return {
          total: 2,
          candidates: [
            { path: 'notes/changed.md', modifiedMs: 2_000, storedMtime: 1_000, storedHash: 'old' },
          ],
          orphans: [{ path: 'notes/gone.md', storedMtime: 1_000, storedHash: 'gone' }],
          stalePlaceholders: [],
        }
      }
      if (command === 'note_read') {
        return `# ${String(args['path'])}\n`
      }
      if (command === 'db_query') {
        return []
      }
      return null
    })

    await reconcileIndex({ generation: 4 })

    const apply = mockInvoke.mock.calls.find(([cmd]) => cmd === 'index_apply_batch')
    const notes = (apply![1] as { notes: Array<{ path: string; mtime: number }> }).notes
    expect(notes.map((note) => note.path)).toEqual(['notes/changed.md'])
    expect(notes[0]!.mtime).toBe(2_000)
    const remove = mockInvoke.mock.calls.find(([cmd]) => cmd === 'index_remove_batch')
    expect(remove![1]).toMatchObject({ paths: ['notes/gone.md'], generation: 4 })
  })

  it('removes the row for a candidate that vanished between the scan and the read', async () => {
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'index_reconcile_scan') {
        return {
          total: 1,
          candidates: [
            { path: 'notes/ghost.md', modifiedMs: 2_000, storedMtime: 1_000, storedHash: 'h' },
          ],
          orphans: [],
          stalePlaceholders: [],
        }
      }
      if (command === 'note_read') {
        throw { kind: 'notFound', message: 'vanished' }
      }
      if (command === 'db_query') {
        return []
      }
      return null
    })

    await reconcileIndex({ generation: 4 })

    const remove = mockInvoke.mock.calls.find(([cmd]) => cmd === 'index_remove_batch')
    expect(remove![1]).toMatchObject({ paths: ['notes/ghost.md'], generation: 4 })
  })
})

describe('iCloud eviction placeholders (Plan 21)', () => {
  /** A graph whose listing carries `files`; every note_read throws notFound. */
  // Reconcile-side placeholder rules (never a candidate, never an orphan)
  // now live in the Rust scan — `reconcile_scan_classifies_candidates_orphans_and_skips`
  // in src-tauri covers them. Only the rebuild path still walks the listing here.
  it('rebuild indexes readable files and skips evicted ones', async () => {
    mockInvoke.mockImplementation(async (command, args) => {
      if (command === 'list_files') {
        return [
          { path: 'notes/real.md', size: 1, modifiedMs: 5 },
          { path: 'notes/evicted.md', size: 1, modifiedMs: 5, placeholder: true },
        ]
      }
      if (command === 'note_read') {
        if (args['path'] === 'notes/real.md') {
          return '# Real\n'
        }
        throw { kind: 'notFound', message: 'evicted' }
      }
      return null
    })

    const stale: string[][] = []
    await rebuildIndex({
      generation: 6,
      onStalePlaceholders: (paths) => {
        stale.push([...paths])
      },
    })

    const batch = mockInvoke.mock.calls.find(([cmd]) => cmd === 'index_apply_batch')
    const notes = (batch![1] as { notes: { path: string }[] }).notes
    expect(notes.map((note) => note.path)).toEqual(['notes/real.md'])
    // The wipe dropped the evicted note's row and the rebuild couldn't read
    // it — it must be surfaced for a targeted download, or it silently
    // disappears from search until something else materializes it.
    expect(stale).toEqual([['notes/evicted.md']])
  })

  it('reconcile surfaces stale placeholders for targeted downloads', async () => {
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'index_reconcile_scan') {
        return {
          total: 3,
          candidates: [],
          orphans: [],
          stalePlaceholders: ['notes/remote-edit.md', 'notes/never-local.md'],
        }
      }
      if (command === 'db_query') {
        return []
      }
      return null
    })

    const stale: string[][] = []
    await reconcileIndex({
      generation: 4,
      onStalePlaceholders: (paths) => {
        stale.push([...paths])
      },
    })

    expect(stale).toEqual([['notes/remote-edit.md', 'notes/never-local.md']])
    // Placeholders are never read — that would force the very downloads the
    // callback exists to make targeted and non-blocking.
    expect(mockInvoke.mock.calls.map(([cmd]) => cmd)).not.toContain('note_read')
  })
})
