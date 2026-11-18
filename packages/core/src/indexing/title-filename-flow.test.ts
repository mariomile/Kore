import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_VAULT_LAYOUT, setVaultLayout } from '../graph/vault-layout'
import { setBridge } from '../ipc/bridge'
import { applyProjection, connectIndex, openMigratedIndex, project } from './flow-test-harness'
import { getBacklinks, resolveWikiTarget } from './queries'

describe('filename-first addressing in a title-named (Obsidian) vault', () => {
  afterEach(() => setVaultLayout(DEFAULT_VAULT_LAYOUT))

  it('opens and backlinks the note named by its file, not a note whose H1 says the same', async () => {
    setVaultLayout({ ...DEFAULT_VAULT_LAYOUT, noteFileNames: 'title' })
    const database = openMigratedIndex()
    const person = 'CRM/People/Mario Miletta.md'
    // Sorts before `CRM/`, so a first-path tie-break would hand it the name.
    const cv = 'Active/Jobs/CV Cohere.md'
    const daily = 'daily/2026-11-18.md'
    applyProjection(database, project(cv, '# Mario Miletta\n\nHead of Product\n', 10))
    applyProjection(database, project(person, '# Mario Miletta\n', 20))
    applyProjection(
      database,
      project(daily, 'Call with [[Mario Miletta]] about [[CV Cohere]]\n', 30),
    )
    connectIndex(database)

    try {
      expect(await resolveWikiTarget('Mario Miletta')).toEqual({
        kind: 'resolved',
        ref: person,
      })
      expect(await resolveWikiTarget('CV Cohere')).toEqual({
        kind: 'resolved',
        ref: cv,
      })
      expect((await getBacklinks(person)).map((link) => link.sourcePath)).toEqual([daily])
      expect((await getBacklinks(cv)).map((link) => link.sourcePath)).toEqual([daily])
    } finally {
      setBridge(null)
      database.close()
    }
  })

  it('still reaches a note by a unique H1 that differs from its file', async () => {
    setVaultLayout({ ...DEFAULT_VAULT_LAYOUT, noteFileNames: 'title' })
    const database = openMigratedIndex()
    applyProjection(database, project('Projects/Plan.md', '# Weekly Planning\n', 10))
    connectIndex(database)
    try {
      expect(await resolveWikiTarget('Weekly Planning')).toEqual({
        kind: 'resolved',
        ref: 'Projects/Plan.md',
      })
      expect(await resolveWikiTarget('Plan')).toEqual({
        kind: 'resolved',
        ref: 'Projects/Plan.md',
      })
    } finally {
      setBridge(null)
      database.close()
    }
  })
})
