import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import { setBridge } from '../ipc/bridge'
import { applyProjection, openMigratedIndex, project } from './flow-test-harness'
import { PROJECTION_VERSION, PROJECTION_VERSION_KEY, type IndexedNote } from './indexed-note'
import { syncIndex } from './indexer'

/**
 * The projection-bump pass against a real SQLite index from the production
 * migrations: an index stamped by an older app is refreshed note by note over
 * its rows, so the app keeps answering from it for the whole pass, and it
 * ends holding exactly the notes on disk under the current stamp.
 */
let database: DatabaseSync
let disk: Map<string, string>
/** Indexed note titles as a reader saw them at each file read of the pass. */
let seenDuringPass: string[][]

function titles(): string[] {
  return database
    .prepare('SELECT title FROM notes ORDER BY path')
    .all()
    .map((row) => String(row['title']))
}

function stamp(): string | undefined {
  const row = database
    .prepare('SELECT value FROM index_meta WHERE key = ?')
    .get(PROJECTION_VERSION_KEY)
  return row === undefined ? undefined : String(row['value'])
}

function removeRows(path: string): void {
  database.prepare('DELETE FROM search_fts WHERE path = ?').run(path)
  database.prepare('DELETE FROM notes WHERE path = ?').run(path)
}

beforeEach(() => {
  database = openMigratedIndex()
  database.exec('PRAGMA foreign_keys = ON')
  seenDuringPass = []
  // What the older app indexed: three notes, stamped with its version.
  for (const [path, title] of [
    ['notes/a.md', 'Alpha (old)'],
    ['notes/b.md', 'Beta (old)'],
    ['notes/gone.md', 'Deleted since'],
  ] as const) {
    applyProjection(database, project(path, `# ${title}\n`, 1000))
  }
  database
    .prepare('INSERT INTO index_meta(key, value) VALUES (?, ?)')
    .run(PROJECTION_VERSION_KEY, String(PROJECTION_VERSION - 1))
  // What is on disk now.
  disk = new Map([
    ['notes/a.md', '# Alpha\n'],
    ['notes/b.md', '# Beta\n'],
  ])
  setBridge({
    invoke: (command, args) => {
      switch (command) {
        case 'list_files':
          return Promise.resolve(
            [...disk.keys()].map((path) => ({ path, size: 1, modifiedMs: 2000 })),
          )
        case 'note_read': {
          seenDuringPass.push(titles())
          return Promise.resolve(disk.get(String(args['path'])))
        }
        case 'index_apply_batch':
          for (const note of args['notes'] as IndexedNote[]) {
            removeRows(note.path)
            applyProjection(database, note)
          }
          return Promise.resolve(null)
        case 'index_remove_batch':
          for (const path of args['paths'] as string[]) {
            removeRows(path)
          }
          return Promise.resolve(null)
        case 'index_meta_set':
          database
            .prepare('INSERT OR REPLACE INTO index_meta(key, value) VALUES (?, ?)')
            .run(String(args['key']), String(args['value']))
          return Promise.resolve(null)
        case 'index_tag_types_resolve':
          return Promise.resolve(null)
        case 'db_query':
          return Promise.resolve(
            database.prepare(String(args['sql'])).all(...(args['params'] as SQLInputValue[])),
          )
        default:
          return Promise.reject(new Error(`unexpected command: ${command}`))
      }
    },
    listen: () => Promise.resolve(() => {}),
  })
})

afterEach(() => {
  setBridge(null)
  database.close()
})

describe('projection refresh', () => {
  it('keeps the old index answering through the pass, then holds exactly what is on disk', async () => {
    await syncIndex({ generation: 1 })

    // Every read of the pass still saw all three notes: nothing was wiped.
    expect(seenDuringPass).toHaveLength(2)
    for (const seen of seenDuringPass) {
      expect(seen).toHaveLength(3)
    }
    expect(titles()).toEqual(['Alpha', 'Beta'])
    expect(stamp()).toBe(String(PROJECTION_VERSION))
  })

  it('reconciles on the following open instead of re-reading the vault', async () => {
    await syncIndex({ generation: 1 })
    seenDuringPass = []
    // The stamp is current now, so the next sync is the cheap reconcile; the
    // harness has no scan command, and reaching for it is the proof.
    await expect(syncIndex({ generation: 1 })).rejects.toThrow(
      'unexpected command: index_reconcile_scan',
    )
    expect(seenDuringPass).toEqual([])
  })
})
