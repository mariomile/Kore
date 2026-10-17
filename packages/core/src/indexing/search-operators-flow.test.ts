import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setBridge } from '../ipc/bridge'
import { parseSearchQuery } from './filter-query'
import { searchWithFilters } from './filtered-search'
import { applyProjection, connectIndex, openMigratedIndex, project } from './flow-test-harness'

/**
 * The Obsidian search operators end to end: parsed in core, run as SQL plus
 * FTS against the real migrated schema (`search_fts` rows keyed by the note
 * rowid, as the indexer writes them).
 */
const NOTES: ReadonlyArray<readonly [path: string, source: string]> = [
  [
    'CRM/People/Ada Lovelace.md',
    '---\ntags: [type/person]\nstatus: active\n---\n# Ada Lovelace\n\nMet at the analytical engine meetup.\n',
  ],
  [
    'CRM/People/Charles Babbage.md',
    '---\ntags: [type/person, archive]\nstatus: active\n---\n# Charles Babbage\n\nEngine design notes.\n',
  ],
  [
    'CRM/Companies/Engine Works.md',
    '---\ntags: [type/company]\n---\n# Engine Works\n\nThe engine meetup venue.\n',
  ],
  ['Journal/Daily/01-10-2026.md', '# 01-10-2026\n\nMeetup about the engine, draft agenda.\n'],
]

let database: DatabaseSync

beforeEach(() => {
  database = openMigratedIndex()
  for (const [index, [path, source]] of NOTES.entries()) {
    const indexed = project(path, source, index + 1)
    applyProjection(database, indexed)
    database
      .prepare(
        'INSERT INTO search_fts(rowid, path, title, body) SELECT rowid, path, title, ? FROM notes WHERE path = ?',
      )
      .run(source, path)
  }
  connectIndex(database)
})

afterEach(() => {
  setBridge(null)
  database.close()
})

async function paths(query: string): Promise<string[]> {
  const hits = await searchWithFilters(parseSearchQuery(query), { limit: null })
  return hits.map((hit) => hit.path).sort()
}

describe('search operators flow', () => {
  it('filters by nested frontmatter tags, path, file name, property and exclusions', async () => {
    expect(await paths('tag:#type')).toEqual([
      'CRM/Companies/Engine Works.md',
      'CRM/People/Ada Lovelace.md',
      'CRM/People/Charles Babbage.md',
    ])
    expect(await paths('#type/person -#archive')).toEqual(['CRM/People/Ada Lovelace.md'])
    expect(await paths('engine path:crm/people')).toEqual([
      'CRM/People/Ada Lovelace.md',
      'CRM/People/Charles Babbage.md',
    ])
    expect(await paths('engine -path:CRM/')).toEqual(['Journal/Daily/01-10-2026.md'])
    expect(await paths('file:babbage')).toEqual(['CRM/People/Charles Babbage.md'])
    expect(await paths('[status:active] -file:ada')).toEqual(['CRM/People/Charles Babbage.md'])
  })

  it('matches exact phrases and excludes words and phrases', async () => {
    expect(await paths('"engine meetup"')).toEqual([
      'CRM/Companies/Engine Works.md',
      'CRM/People/Ada Lovelace.md',
    ])
    expect(await paths('meetup -draft -"analytical engine"')).toEqual([
      'CRM/Companies/Engine Works.md',
    ])
    const [hit] = await searchWithFilters(parseSearchQuery('"engine meetup" path:People'))
    expect(hit?.snippet).toContain('engine')
  })
})
