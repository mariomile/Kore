import { describe, expect, it } from 'vitest'
import { buildFolderTree, hasOwnFolders } from './folder-tree'

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
