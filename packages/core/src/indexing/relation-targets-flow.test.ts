import { describe, expect, it } from 'vitest'
import { setBridge } from '../ipc/bridge'
import { applyProjection, connectIndex, openMigratedIndex, project } from './flow-test-harness'
import { suggestRelationTargets } from './queries'

/**
 * Typed relations: the scoped suggester offers only the target collection's
 * rows — the same verified addresses `suggestWikiLinkTargets` hands out, cut
 * down to notes carrying the tag.
 */
describe('suggestRelationTargets', () => {
  it('offers only notes carrying the target tag, empty query included', async () => {
    const database = openMigratedIndex()
    applyProjection(database, project('notes/sarah-chen.md', '# Sarah Chen\n\n#person\n', 30))
    applyProjection(database, project('notes/sarah-plan.md', '# Sarah Plan\n\nno tag here\n', 20))
    applyProjection(database, project('notes/kore.md', '# Kore\n\n#company\n', 10))
    connectIndex(database)

    try {
      // A query that matches inside and outside the collection: only the
      // member survives the scope.
      const scoped = await suggestRelationTargets('sarah', 'person')
      expect(scoped.suggestions.map((row) => row.insertText)).toEqual(['Sarah Chen'])

      // At rest (empty query) the picker lists the collection's rows — not
      // the whole graph's recents.
      const atRest = await suggestRelationTargets('', 'person')
      expect(atRest.suggestions.map((row) => row.insertText)).toEqual(['Sarah Chen'])

      // A different target scopes to its own rows.
      const company = await suggestRelationTargets('', 'company')
      expect(company.suggestions.map((row) => row.insertText)).toEqual(['Kore'])
    } finally {
      setBridge(null)
      database.close()
    }
  })
})
