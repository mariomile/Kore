import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { setBridge } from '../ipc/bridge'
import { applyProjection, connectIndex, openMigratedIndex, project } from './flow-test-harness'
import { listTagTypes } from './collections'
import { listNotes, listNoteTags } from './note-list'

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
  it('classifies Inbox from the same index snapshot, including empty supertag schemas', async () => {
    addNote('notes/plain.md', '# Plain', 3000)
    addNote('notes/typed.md', '# Typed\n\n#Project #topic', 2000)
    addNote('daily/2026-09-10.md', '# Daily\n\n#project', 1000)
    addNote('tags/project.md', '---\nlore: tag\n---\n# Project', 100)
    database
      .prepare('INSERT INTO tag_types (tag_key, note_path, schema_json) VALUES (?, ?, ?)')
      .run('project', 'tags/project.md', '[]')

    expect((await listNotes()).map(({ path, isInbox }) => ({ path, isInbox }))).toEqual([
      { path: 'notes/plain.md', isInbox: true },
      { path: 'notes/typed.md', isInbox: false },
    ])
    expect((await listNotes({ tag: 'project' })).every((note) => !note.isInbox)).toBe(true)
    database
      .prepare('DELETE FROM tags WHERE note_path = ? AND tag_key = ?')
      .run('notes/typed.md', 'project')
    expect((await listNotes()).every((note) => note.isInbox)).toBe(true)
  })

  it('treats malformed supertag schemas as untyped, like the properties panel', async () => {
    addNote('notes/project.md', '# Project\n\n#project', 1000)
    addNote('tags/project.md', '---\nlore: tag\n---\n# Project', 100)
    database
      .prepare('INSERT INTO tag_types (tag_key, note_path, schema_json) VALUES (?, ?, ?)')
      .run('project', 'tags/project.md', '{"properties":42}')
    expect((await listNotes())[0]!.isInbox).toBe(true)
  })

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

describe('tag listings for outbound surfaces against a real index', () => {
  it('drops tags only private notes carry, counts public notes only, hides private definitions', async () => {
    addNote('notes/public-a.md', '# A\n\n#company #decision', 3000)
    addNote('notes/public-b.md', '# B\n\n#company', 2000)
    addNote('notes/secret.md', '---\nprivate: true\n---\n# Secret\n\n#company #diary', 1000)
    addNote('tags/company.md', '---\nlore: tag\nicon: icon:buildings\n---\n# Company', 100)
    addNote('tags/diary.md', '---\nlore: tag\nprivate: true\nicon: 🔒\n---\n# Diary', 100)
    const insertType = database.prepare(
      'INSERT INTO tag_types (tag_key, note_path, schema_json) VALUES (?, ?, ?)',
    )
    insertType.run('company', 'tags/company.md', '{"properties":[],"icon":"icon:buildings"}')
    insertType.run('diary', 'tags/diary.md', '{"properties":[],"icon":"🔒"}')

    // The user's own sidebar still sees everything.
    expect(await listNoteTags()).toEqual([
      { tag: 'company', count: 3 },
      { tag: 'decision', count: 1 },
      { tag: 'diary', count: 1 },
    ])
    expect((await listTagTypes()).map((entry) => entry.tagKey)).toEqual(['company', 'diary'])

    // Outbound: no `diary` (only a private note carries it), `company`
    // counted without the private note, the private definition gone.
    expect(await listNoteTags({ excludePrivate: true })).toEqual([
      { tag: 'company', count: 2 },
      { tag: 'decision', count: 1 },
    ])
    expect((await listTagTypes({ excludePrivate: true })).map((entry) => entry.tagKey)).toEqual([
      'company',
    ])
  })
})
