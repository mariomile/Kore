import { validateFolderName, type FolderTreeFolder } from '@kore/core'

/** One folder as a pick-list row (the Move to folder picker on Mac and iPhone). */
export interface FolderOption {
  /** Graph-relative path. */
  readonly path: string
  readonly name: string
  /** The parent folder's path, shown muted beside the name; `''` at the root. */
  readonly parent: string
}

/** What the picker lists for a query. */
export interface FolderPick {
  /** The folders to show, in tree order. */
  readonly matches: readonly FolderOption[]
  /** The typed path when no folder has it yet: the picker offers to create it. */
  readonly newFolder: string | null
  /** Why the typed path can't be a folder (a segment starts with a dot…). */
  readonly problem: string | null
}

/**
 * Every folder below the root, depth first, alphabetical at each level as the
 * tree already is. `exclude` drops a folder and everything inside it: a
 * folder can't move into itself.
 */
export function flattenFolders(
  root: FolderTreeFolder,
  exclude: string | null = null,
): FolderOption[] {
  const out: FolderOption[] = []
  const walk = (folder: FolderTreeFolder): void => {
    for (const child of folder.folders) {
      if (exclude !== null && (child.path === exclude || child.path.startsWith(`${exclude}/`))) {
        continue
      }
      out.push({ path: child.path, name: child.name, parent: folder.path })
      walk(child)
    }
  }
  walk(root)
  return out
}

/** The folder path a query names: trimmed, without leading or trailing slashes. */
export function typedFolderPath(query: string): string {
  return query
    .trim()
    .replaceAll(/^\/+|\/+$/g, '')
    .replaceAll(/\s*\/\s*/g, '/')
}

/**
 * The folders whose path holds every word of `query` (case-insensitive), and
 * the typed path as a new folder when none has exactly that path and every
 * segment is a valid folder name.
 */
export function pickFolders(options: readonly FolderOption[], query: string): FolderPick {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const matches =
    words.length === 0
      ? options
      : options.filter((option) => {
          const haystack = option.path.toLowerCase()
          return words.every((word) => haystack.includes(word))
        })
  const typed = typedFolderPath(query)
  const exists = options.some((option) => option.path.toLowerCase() === typed.toLowerCase())
  if (typed === '' || exists) {
    return { matches, newFolder: null, problem: null }
  }
  const problem =
    typed
      .split('/')
      .map(validateFolderName)
      .find((message) => message !== null) ?? null
  return { matches, newFolder: problem === null ? typed : null, problem }
}

/** A folder path as a pick-list row: its last segment over its parent. */
export function folderOption(path: string): FolderOption {
  const slash = path.lastIndexOf('/')
  return slash === -1
    ? { path, name: path, parent: '' }
    : { path, name: path.slice(slash + 1), parent: path.slice(0, slash) }
}

/** How many suggestions the picker shows above the folder list. */
export const SUGGESTION_LIMIT = 3

/**
 * The picker's suggestions, in the order given (the note's type folders
 * first, then the latest destinations): the target's current folder, the
 * excluded folder's subtree and repeats dropped, at most
 * {@link SUGGESTION_LIMIT}. A suggested folder may not exist yet (a type's
 * home nobody filed into): moving there creates it.
 */
export function suggestFolders(
  candidates: readonly string[],
  current: string,
  exclude: string | null = null,
): FolderOption[] {
  const seen = new Set<string>()
  const out: FolderOption[] = []
  for (const path of candidates) {
    const key = path.toLowerCase()
    if (
      path === '' ||
      path === current ||
      seen.has(key) ||
      (exclude !== null && (path === exclude || path.startsWith(`${exclude}/`)))
    ) {
      continue
    }
    seen.add(key)
    out.push(folderOption(path))
    if (out.length === SUGGESTION_LIMIT) {
      break
    }
  }
  return out
}
