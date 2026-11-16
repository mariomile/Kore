import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { setBridge } from '../ipc/bridge'
import {
  applyProjection,
  applyTagTypeRow,
  connectIndex,
  openMigratedIndex,
  project,
} from './flow-test-harness'
import { getTagType } from './collections'
import { birthPathForTitle } from './note-paths'
import { refreshTagTypeResolutions } from './resolved-tag-types'

/**
 * A type's home folder (`folder:`) against a real SQLite index from the
 * production migrations: the definition's key survives the inheritance pass
 * into the stored type, and an untitled note of the type is born there.
 */
let database: DatabaseSync

beforeEach(() => {
  database = openMigratedIndex()
  connectIndex(database)
})

afterEach(() => {
  setBridge(null)
  database.close()
})

function addNote(path: string, source: string): void {
  const indexed = project(path, source, 1000)
  applyProjection(database, indexed)
  applyTagTypeRow(database, indexed)
}

const free = async (): Promise<boolean> => false
const untitled = (tags: string): string => `---\nid: 01abc\ntags: [${tags}]\n---\n# Kore Cloud\n`

describe('type home folder', () => {
  beforeEach(async () => {
    addNote(
      'tags/type/project.md',
      '---\nkore: tag\nfolder: Active/Projects/{title}\nproperties: []\n---\n',
    )
    addNote('tags/person.md', '---\nkore: tag\nfolder: CRM/People\nproperties: []\n---\n')
    addNote('tags/book.md', '---\nkore: tag\nproperties: []\n---\n')
    await refreshTagTypeResolutions(1)
  })

  it('reads the folder off the stored type', async () => {
    expect((await getTagType('type/project'))?.folder).toBe('Active/Projects/{title}')
    expect((await getTagType('book'))?.folder).toBeUndefined()
  })

  it('births an untitled note of a homed type in its folder', async () => {
    await expect(
      birthPathForTitle('notes/01abc.md', 'Kore Cloud', untitled('type/project'), free),
    ).resolves.toBe('Active/Projects/kore-cloud/kore-cloud.md')
    await expect(
      birthPathForTitle('notes/01abc.md', 'Ada Lovelace', untitled('person'), free),
    ).resolves.toBe('CRM/People/ada-lovelace.md')
  })

  it('suffixes around an occupied home the same way as the new-note folder', async () => {
    const occupied = new Set(['Active/Projects/kore-cloud/kore-cloud.md'])
    await expect(
      birthPathForTitle('notes/01abc.md', 'Kore Cloud', untitled('type/project'), async (path) =>
        occupied.has(path),
      ),
    ).resolves.toBe('Active/Projects/kore-cloud-2/kore-cloud-2.md')
  })

  it('keeps the slug path for a type without a home or an untyped note', async () => {
    await expect(birthPathForTitle('notes/01abc.md', 'Dune', untitled('book'), free)).resolves.toBe(
      'notes/dune.md',
    )
    await expect(birthPathForTitle('notes/01abc.md', 'Dune', '# Dune\n', free)).resolves.toBe(
      'notes/dune.md',
    )
  })
})
