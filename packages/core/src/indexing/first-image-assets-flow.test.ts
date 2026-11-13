import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { setAttachmentIndex } from '../graph/attachment-index'
import { setBridge } from '../ipc/bridge'
import { firstImageAssets } from './asset-refs'
import { applyProjection, connectIndex, openMigratedIndex, project } from './flow-test-harness'

/** The mobile note grid's card thumbnails, against the real `assets` projection. */
let database: DatabaseSync

beforeEach(() => {
  database = openMigratedIndex()
  connectIndex(database)
})

afterEach(() => {
  setAttachmentIndex(null)
  setBridge(null)
  database.close()
})

describe('firstImageAssets', () => {
  it("names each note's first existing raster image and skips the rest", async () => {
    applyProjection(database, project('notes/person.md', '# Person\n', 1000))
    applyProjection(database, project('notes/plain.md', '# Plain\n', 1000))
    // The projection stores every spelling of a reference, in document order:
    // `assets/face.jpg` written in notes/ is also `notes/assets/face.jpg`.
    const insert = database.prepare('INSERT INTO assets (note_path, asset_path) VALUES (?, ?)')
    for (const asset of [
      'notes/assets/brief.pdf',
      'assets/brief.pdf',
      'assets/drawing.svg',
      'notes/assets/face.jpg',
      'assets/face.jpg',
      'assets/second.png',
    ]) {
      insert.run('notes/person.md', asset)
    }
    setAttachmentIndex([
      'assets/brief.pdf',
      'assets/drawing.svg',
      'assets/face.jpg',
      'assets/second.png',
    ])

    const images = await firstImageAssets(['notes/person.md', 'notes/plain.md'])

    expect([...images]).toEqual([['notes/person.md', 'assets/face.jpg']])
  })
})
