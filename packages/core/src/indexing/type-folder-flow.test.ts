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
import { DEFAULT_VAULT_LAYOUT, setVaultLayout } from '../graph/vault-layout'
import { getTagType } from './collections'
import { birthPathForTitle, homePathForTaggedInboxNote, typeFoldersForNote } from './note-paths'
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
  setVaultLayout(DEFAULT_VAULT_LAYOUT)
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

  it('suggests the homes of the types a note is a member of', async () => {
    addNote('notes/ada.md', untitled('person, book'))
    addNote('notes/kore.md', untitled('type/project'))
    addNote('notes/dune.md', '# Dune\n\nReading with #person in mind\n')
    await expect(typeFoldersForNote('notes/ada.md')).resolves.toEqual(['CRM/People'])
    await expect(typeFoldersForNote('notes/kore.md')).resolves.toEqual(['Active/Projects/kore'])
    await expect(typeFoldersForNote('notes/dune.md')).resolves.toEqual([])
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

  it('auto-moves a titled note from the inbox folder into a tagged home folder', async () => {
    setVaultLayout({ ...DEFAULT_VAULT_LAYOUT, newNoteFolder: 'inbox', noteFileNames: 'title' })
    await expect(
      homePathForTaggedInboxNote('inbox/Ada Lovelace.md', 'CRM/People', free),
    ).resolves.toBe('CRM/People/Ada Lovelace.md')
    await expect(
      homePathForTaggedInboxNote('inbox/Kore Cloud.md', 'Active/Projects/{title}', free),
    ).resolves.toBe('Active/Projects/Kore Cloud/Kore Cloud.md')
    await expect(homePathForTaggedInboxNote('inbox/Kore Cloud.md', '{title}', free)).resolves.toBe(
      'Kore Cloud/Kore Cloud.md',
    )
    await expect(
      homePathForTaggedInboxNote('inbox/Ada Lovelace.md', '/CRM/People/', free),
    ).resolves.toBe('CRM/People/Ada Lovelace.md')

    // Collision suffixes keep working in the target folder.
    const taken = new Set(['CRM/People/Ada Lovelace.md'])
    await expect(
      homePathForTaggedInboxNote('inbox/Ada Lovelace.md', 'CRM/People', async (p) => taken.has(p)),
    ).resolves.toBe('CRM/People/Ada Lovelace 2.md')

    // Already-filed notes, dailies, and untitled ULID placeholders never auto-move.
    await expect(
      homePathForTaggedInboxNote('Knowledge/Ada Lovelace.md', 'CRM/People', free),
    ).resolves.toBeNull()
    await expect(
      homePathForTaggedInboxNote('daily/2026-11-22.md', 'CRM/People', free),
    ).resolves.toBeNull()
    await expect(
      homePathForTaggedInboxNote('inbox/01jxk2v9qz3m4n5p6r7s8t9vwx.md', 'CRM/People', free),
    ).resolves.toBeNull()
  })
})
