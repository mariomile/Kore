import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { setBridge } from '../ipc/bridge'
import { applyProjection, connectIndex, openMigratedIndex, project } from './flow-test-harness'
import { listNotes } from './note-list'

/**
 * The All Notes list against a real SQLite built from the production migration
 * chain, not a bridge returning canned rows.
 *
 * `note-list.test.ts` inspects the compiled SQL, which proves the column names
 * and parameters but never executes it. The tag fold uses `group_concat` with
 * an ORDER BY and a separator, so a syntax error, a wrong grouping, or a
 * separator that splits a tag in half would all pass that check and fail only
 * in the app.
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

function addNote(path: string, source: string, mtime: number): void {
  applyProjection(database, project(path, source, mtime))
}

describe('listNotes against a real index', () => {
  it('returns each note once with all of its tags, alphabetical by folded key', async () => {
    addNote('notes/health.md', '# Health\n\n#Zebra and #alpha and #Beta here.\n', 2000)
    addNote('notes/plain.md', '# Plain\n\nNo tags at all.\n', 1000)

    const entries = await listNotes()

    expect(entries.map((entry) => entry.path)).toEqual(['notes/health.md', 'notes/plain.md'])
    // Folded-key order, display casing preserved.
    expect(entries[0]!.tags).toEqual(['alpha', 'Beta', 'Zebra'])
    // A note with no tags gets an empty list, never a phantom empty-string tag.
    expect(entries[1]!.tags).toEqual([])
  })

  it('lists a tag-filtered note once, carrying its other tags too', async () => {
    // The filter is an EXISTS, so a note matching the tag must not be
    // duplicated, and its full tag set must survive the grouping.
    addNote('notes/a.md', '# A\n\n#project and #urgent and #later.\n', 3000)
    addNote('notes/b.md', '# B\n\n#other only.\n', 2000)

    const entries = await listNotes({ tag: 'project' })

    expect(entries.map((entry) => entry.path)).toEqual(['notes/a.md'])
    expect(entries[0]!.tags).toEqual(['later', 'project', 'urgent'])
  })

  it('matches a tag case-insensitively and includes tagged daily notes', async () => {
    addNote('daily/2026-08-29.md', '# Friday\n\n#Project standup.\n', 4000)
    addNote('notes/a.md', '# A\n\n#project notes.\n', 3000)

    const entries = await listNotes({ tag: 'PROJECT' })

    expect(entries.map((entry) => entry.path)).toEqual(['daily/2026-08-29.md', 'notes/a.md'])
  })

  it('excludes daily notes from the unfiltered list', async () => {
    addNote('daily/2026-08-29.md', '# Friday\n\nA day.\n', 4000)
    addNote('notes/a.md', '# A\n\nA note.\n', 3000)

    expect((await listNotes()).map((entry) => entry.path)).toEqual(['notes/a.md'])
  })

  it('keeps pinned notes first, then newest', async () => {
    addNote('notes/old-pin.md', '---\npinned: true\n---\n\n# Old Pin\n\nBody.\n', 100)
    addNote('notes/fresh.md', '# Fresh\n\nBody.\n', 9000)

    expect((await listNotes()).map((entry) => entry.path)).toEqual([
      'notes/old-pin.md',
      'notes/fresh.md',
    ])
  })
})
