import type { FolderTreeFolder } from '@kore/core'

/** One folder as a pick-list row (the Move to folder picker on Mac and iPhone). */
export interface FolderOption {
  /** Graph-relative path; `''` is the vault root. */
  path: string
  name: string
  /** The parent folder's path, shown muted beside the name. */
  parent: string
  noteCount: number
}

/** Every folder below the root, depth first, alphabetical at each level. */
export function flattenFolders(root: FolderTreeFolder): FolderOption[] {
  const out: FolderOption[] = []
  const walk = (folder: FolderTreeFolder): void => {
    for (const child of folder.folders) {
      out.push({
        path: child.path,
        name: child.name,
        parent: folder.path,
        noteCount: child.noteCount,
      })
      walk(child)
    }
  }
  walk(root)
  return out
}

/** Folders whose path contains every word of `query`, case-insensitively. */
export function matchFolders(options: readonly FolderOption[], query: string): FolderOption[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) {
    return [...options]
  }
  return options.filter((option) => {
    const haystack = option.path.toLowerCase()
    return words.every((word) => haystack.includes(word))
  })
}

/** Find a folder by path in the tree; null when it isn't there. */
export function findFolder(root: FolderTreeFolder, path: string): FolderTreeFolder | null {
  if (path === '') {
    return root
  }
  let folder: FolderTreeFolder | undefined = root
  for (const segment of path.split('/')) {
    folder = folder?.folders.find((child) => child.name === segment)
    if (folder === undefined) {
      return null
    }
  }
  return folder
}
