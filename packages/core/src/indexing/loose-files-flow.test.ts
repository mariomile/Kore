import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { getBridge, setBridge } from '../ipc/bridge'
import { applyProjection, connectIndex, openMigratedIndex, project } from './flow-test-harness'
import { looseFiles, looseFilesAffectedBy } from './loose-files'

/** A folder page's loose-file cards, against the real `assets` projection. */
let database: DatabaseSync

/** The host's file catalog on top of the index bridge. */
function catalog(files: Array<[path: string, modifiedMs: number]>): void {
  const index = getBridge()
  setBridge({
    ...index,
    invoke: async (command, args) =>
      command === 'list_attachments'
        ? files.map(([path, modifiedMs]) => ({ path, size: 1200, modifiedMs }))
        : await index.invoke(command, args),
  })
}

beforeEach(() => {
  database = openMigratedIndex()
  connectIndex(database)
})

afterEach(() => {
  setBridge(null)
  database.close()
})

describe('looseFiles', () => {
  it("lists a folder's unreferenced files, newest first, with their kind", async () => {
    applyProjection(database, project('Studio/brief.md', '# Brief\n', 1000))
    const insert = database.prepare('INSERT INTO assets (note_path, asset_path) VALUES (?, ?)')
    insert.run('Studio/brief.md', 'Studio/embedded.png')
    insert.run('Studio/brief.md', 'by-name.pdf')
    catalog([
      ['Studio/embedded.png', 9000],
      ['Studio/Old/by-name.pdf', 8000],
      ['Studio/mood.jpg', 3000],
      ['Studio/deck.pdf', 5000],
      ['Studio/budget.xlsx', 4000],
      ['Studio/board.canvas', 7000],
      ['Studio/Sub/inner.mp3', 6000],
      ['Studios/sibling.png', 9000],
      ['assets/pasted.png', 9000],
    ])

    const direct = await looseFiles('Studio', false)
    expect(direct.map((file) => [file.name, file.kind])).toEqual([
      ['board.canvas', 'canvas'],
      ['deck.pdf', 'pdf'],
      ['budget.xlsx', 'sheet'],
      ['mood.jpg', 'image'],
    ])

    const deep = await looseFiles('Studio', true)
    expect(deep.map((file) => file.path)).toEqual([
      'Studio/board.canvas',
      'Studio/Sub/inner.mp3',
      'Studio/deck.pdf',
      'Studio/budget.xlsx',
      'Studio/mood.jpg',
    ])
  })

  it('lists a base or canvas even when a note embeds or links it', async () => {
    applyProjection(database, project('Home.md', '# Home\n', 1000))
    const insert = database.prepare('INSERT INTO assets (note_path, asset_path) VALUES (?, ?)')
    insert.run('Home.md', 'Jobs/Application board.base')
    insert.run('Home.md', 'Map.canvas')
    insert.run('Home.md', 'Jobs/cv.pdf')
    catalog([
      ['Jobs/Application board.base', 3000],
      ['Jobs/Map.canvas', 2000],
      ['Jobs/cv.pdf', 1000],
    ])

    expect((await looseFiles('Jobs', false)).map((file) => [file.name, file.kind])).toEqual([
      ['Application board.base', 'base'],
      ['Map.canvas', 'canvas'],
    ])
  })

  it('never counts the attachment folder', async () => {
    catalog([['assets/pasted.png', 1]])
    expect(await looseFiles('', true)).toEqual([])
  })
})

describe('looseFilesAffectedBy', () => {
  it('names a batch that touches a file in the folder', () => {
    const change = (path: string) => ({ path, kind: 'upsert' as const, modifiedMs: 1 })
    expect(looseFilesAffectedBy([change('Studio/deck.pdf')], 'Studio', false)).toBe(true)
    expect(looseFilesAffectedBy([change('Studio/Sub/deck.pdf')], 'Studio', false)).toBe(false)
    expect(looseFilesAffectedBy([change('Studio/Sub/deck.pdf')], 'Studio', true)).toBe(true)
    expect(looseFilesAffectedBy([change('Studio/brief.md')], 'Studio', true)).toBe(false)
  })
})
