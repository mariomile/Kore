import { describe, expect, it } from 'vitest'
import type { FolderTreeFolder } from '@kore/core'
import { flattenFolders, pickFolders, suggestFolders } from './folder-options'

function folder(path: string, folders: FolderTreeFolder[] = []): FolderTreeFolder {
  return { path, name: path.split('/').at(-1) ?? '', folders, notes: [], noteCount: 0 }
}

const tree = folder('', [
  folder('Active', [folder('Active/Projects')]),
  folder('CRM', [folder('CRM/People'), folder('CRM/Companies')]),
])

describe('folder picker options', () => {
  it('lists every folder in tree order, leaving out a moving folder and its subfolders', () => {
    expect(flattenFolders(tree).map((option) => option.path)).toEqual([
      'Active',
      'Active/Projects',
      'CRM',
      'CRM/People',
      'CRM/Companies',
    ])
    expect(flattenFolders(tree, 'CRM').map((option) => option.path)).toEqual([
      'Active',
      'Active/Projects',
    ])
  })

  it('narrows by every typed word and offers a valid new path only', () => {
    const options = flattenFolders(tree)
    const people = pickFolders(options, 'crm peo')
    expect(people.matches.map((option) => option.path)).toEqual(['CRM/People'])
    expect(people.newFolder).toBe('crm peo')
    expect(pickFolders(options, 'crm/people').newFolder).toBeNull()
    expect(pickFolders(options, ' /Archive / 2026/ ').newFolder).toBe('Archive/2026')
    const hidden = pickFolders(options, 'Archive/.git')
    expect(hidden.newFolder).toBeNull()
    expect(hidden.problem).not.toBeNull()
  })

  it('suggests in order without the current folder, the moving subtree or repeats', () => {
    expect(
      suggestFolders(
        ['CRM/People', 'Inbox', 'crm/people', 'Archive', 'Archive/Old', 'Ideas', 'Later'],
        'Inbox',
        'Archive',
      ),
    ).toEqual([
      { path: 'CRM/People', name: 'People', parent: 'CRM' },
      { path: 'Ideas', name: 'Ideas', parent: '' },
      { path: 'Later', name: 'Later', parent: '' },
    ])
  })
})
