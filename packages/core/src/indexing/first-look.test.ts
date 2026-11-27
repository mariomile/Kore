import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setBridge } from '../ipc/bridge'
import { loadVaultFirstLook } from './first-look'

// A fake bridge answers `db_query` by the table each query reads, so these
// run the real compiled SQL (snake_case columns) whatever order the
// parallel reads land in.
const mockInvoke = vi.fn<(command: string, args: Record<string, unknown>) => Promise<unknown>>()

interface FakeIndex {
  notes: { path: string; title: string; title_key: string }[]
  tags: { note_path: string; tag: string; tag_key: string }[]
  tagTypes: { tag_key: string; schema_json: string }[]
  links: { source_path: string; target_raw: string; target_key: string; pos_from: number }[]
  backlinks: { source_path: string; target_path: string; pos_from: number }[]
  properties: { note_path: string; key: string }[]
}

function serve(index: FakeIndex): void {
  mockInvoke.mockImplementation(async (_command, args) => {
    const sql = String(args['sql'])
    if (sql.includes('from "tags"')) return index.tags
    if (sql.includes('from "tag_types"')) return index.tagTypes
    if (sql.includes('from "links"')) return index.links
    if (sql.includes('from "backlinks"')) return index.backlinks
    if (sql.includes('from "note_properties"')) return index.properties
    if (sql.includes('from "notes"')) return index.notes
    throw new Error(`unexpected query: ${sql}`)
  })
}

function note(path: string, title: string): FakeIndex['notes'][number] {
  return { path, title, title_key: title.toLowerCase() }
}

/** Twelve people in one folder, each tagged and carrying an email. */
function people(): Pick<FakeIndex, 'notes' | 'tags' | 'properties'> {
  const paths = Array.from({ length: 12 }, (_, i) => `CRM/People/Person ${i}.md`)
  return {
    notes: paths.map((path, i) => note(path, `Person ${i}`)),
    tags: paths.map((path) => ({ note_path: path, tag: 'type/person', tag_key: 'type/person' })),
    properties: paths.map((path) => ({ note_path: path, key: 'email' })),
  }
}

beforeEach(() => {
  mockInvoke.mockReset()
  setBridge({ invoke: mockInvoke, listen: async () => () => {} })
})

afterEach(() => {
  setBridge(null)
})

describe('loadVaultFirstLook', () => {
  it('offers a kind of thing as a type and finds orphans, missing notes and duplicate titles', async () => {
    const crm = people()
    // A topic: ten notes share the tag but no folder and no field.
    const topic = Array.from({ length: 10 }, (_, i) => `Area ${i}/Idea.md`)
    serve({
      notes: [
        ...crm.notes,
        ...topic.map((path, i) => note(path, `Idea ${i}`)),
        note('hub.md', 'Hub'),
        note('loose.md', 'Loose'),
        note('a/Plan.md', 'Plan'),
        note('b/Plan.md', 'Plan'),
      ],
      tags: [...crm.tags, ...topic.map((path) => ({ note_path: path, tag: 'ai', tag_key: 'ai' }))],
      tagTypes: [],
      links: [
        { source_path: 'hub.md', target_raw: 'Person 0', target_key: 'person 0', pos_from: 1 },
        { source_path: 'hub.md', target_raw: 'Ghost', target_key: 'ghost', pos_from: 20 },
        // An attachment that isn't indexed is not a missing note.
        { source_path: 'hub.md', target_raw: 'photo.png', target_key: 'photo.png', pos_from: 40 },
      ],
      backlinks: [{ source_path: 'hub.md', target_path: 'CRM/People/Person 0.md', pos_from: 1 }],
      properties: crm.properties,
    })

    const look = await loadVaultFirstLook()

    expect(look.suggestions).toEqual([
      {
        source: 'tag',
        tag: 'type/person',
        label: 'Person',
        count: 12,
        folder: 'CRM/People',
      },
    ])
    expect(look.brokenLinks.targets).toBe(1)
    expect(look.brokenLinks.sample[0]?.target).toBe('Ghost')
    expect(look.orphans.sample.map((orphan) => orphan.path)).toContain('loose.md')
    expect(look.orphans.sample.map((orphan) => orphan.path)).not.toContain('hub.md')
    expect(look.orphans.sample.map((orphan) => orphan.path)).not.toContain('CRM/People/Person 0.md')
    expect(look.duplicates.count).toBe(1)
    expect(look.duplicates.sample[0]?.notes.map((dup) => dup.path)).toEqual([
      'a/Plan.md',
      'b/Plan.md',
    ])

    // Everything that names a note reads public rows only, like Insights.
    for (const [, args] of mockInvoke.mock.calls) {
      const sql = String(args['sql'])
      if (/from "(?:notes|tags|links)"/.test(sql)) {
        expect(sql).toContain('"is_private" = ?')
      }
    }
  })

  it('offers nothing for a tag that is already a type', async () => {
    const crm = people()
    serve({
      ...crm,
      tagTypes: [{ tag_key: 'type/person', schema_json: '{}' }],
      links: [],
      backlinks: [],
    })

    const look = await loadVaultFirstLook()

    expect(look.suggestions).toEqual([])
  })

  it('rejects when the index cannot be read', async () => {
    mockInvoke.mockRejectedValue(new Error('database is locked'))

    await expect(loadVaultFirstLook()).rejects.toThrow('database is locked')
  })
})
