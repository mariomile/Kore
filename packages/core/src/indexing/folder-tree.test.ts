import { afterEach, describe, expect, it } from 'vitest'
import { setBridge } from '../ipc/bridge'
import { buildFolderTree, findFolder, folderTreeAffectedBy, hasOwnFolders } from './folder-tree'

describe('buildFolderTree', () => {
  it('nests notes under their folders, folders first, alphabetical with counts', () => {
    const tree = buildFolderTree([
      { path: 'Active/Projects/Kore/Roadmap.md', title: 'Roadmap' },
      { path: 'Active/Projects/Captoo/Pitch.md', title: 'Pitch' },
      { path: 'Active/Projects/Kore/Bugs.md', title: 'bugs' },
      { path: 'Active/Weekly.md', title: 'Weekly' },
      { path: 'Inbox.md', title: 'Inbox' },
    ])

    expect(tree.noteCount).toBe(5)
    expect(tree.notes.map((note) => note.path)).toEqual(['Inbox.md'])
    const [active] = tree.folders
    expect(active).toMatchObject({
      path: 'Active',
      name: 'Active',
      noteCount: 4,
    })
    expect(active?.notes.map((note) => note.title)).toEqual(['Weekly'])
    const projects = active?.folders[0]
    expect(projects?.folders.map((folder) => [folder.path, folder.noteCount])).toEqual([
      ['Active/Projects/Captoo', 1],
      ['Active/Projects/Kore', 2],
    ])
    expect(projects?.folders[1]?.notes.map((note) => note.title)).toEqual(['bugs', 'Roadmap'])
  })
})

describe('hasOwnFolders', () => {
  it("stays false for a vault that keeps only Kore's fixed folders", () => {
    const kore = buildFolderTree([
      { path: 'daily/2026-10-10.md', title: '2026-10-10' },
      { path: 'notes/idea.md', title: 'Idea' },
      { path: 'loose.md', title: 'Loose' },
    ])
    expect(hasOwnFolders(kore)).toBe(false)
    expect(hasOwnFolders(buildFolderTree([{ path: 'CRM/People/Ada.md', title: 'Ada' }]))).toBe(true)
  })
})

describe('findFolder', () => {
  it('walks to a nested folder by path, and misses unknown ones', () => {
    const tree = buildFolderTree([{ path: 'CRM/People/Ada.md', title: 'Ada' }])

    expect(findFolder(tree, 'CRM/People')?.noteCount).toBe(1)
    expect(findFolder(tree, '')).toBe(tree)
    expect(findFolder(tree, 'CRM/Companies')).toBeNull()
  })
})

describe('folderTreeAffectedBy', () => {
  afterEach(() => {
    setBridge(null)
  })

  const tree = buildFolderTree([
    { path: 'Projects/Kore.md', title: 'Kore' },
    { path: 'inbox.md', title: 'Inbox' },
  ])

  /** Answers the title lookup with `rows`, counting the queries. */
  function indexWithTitles(rows: Array<{ path: string; title: string }>): { queries: number } {
    const seen = { queries: 0 }
    setBridge({
      invoke: async (command) => {
        if (command === 'db_query') {
          seen.queries += 1
          return rows
        }
        return null
      },
      listen: async () => () => {},
    })
    return seen
  }

  it('leaves the tree alone for a body-only save', async () => {
    indexWithTitles([{ path: 'Projects/Kore.md', title: 'Kore' }])
    expect(await folderTreeAffectedBy(tree, [{ path: 'Projects/Kore.md', kind: 'upsert' }])).toBe(
      false,
    )
  })

  it('refreshes for a retitled note', async () => {
    indexWithTitles([{ path: 'inbox.md', title: 'Inbox zero' }])
    expect(await folderTreeAffectedBy(tree, [{ path: 'inbox.md', kind: 'upsert' }])).toBe(true)
  })

  it('refreshes for a new note or a removal without asking the index', async () => {
    const seen = indexWithTitles([])
    expect(await folderTreeAffectedBy(tree, [{ path: 'Projects/New.md', kind: 'upsert' }])).toBe(
      true,
    )
    expect(await folderTreeAffectedBy(tree, [{ path: 'inbox.md', kind: 'remove' }])).toBe(true)
    expect(seen.queries).toBe(0)
  })

  it('refreshes when a held note has lost its index row', async () => {
    indexWithTitles([])
    expect(await folderTreeAffectedBy(tree, [{ path: 'inbox.md', kind: 'upsert' }])).toBe(true)
  })
})
