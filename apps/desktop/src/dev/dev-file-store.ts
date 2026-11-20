import { isNotePath, type FileMeta, type NoteCreateOutcome } from '@kore/core'

/** One in-memory markdown file: contents plus a last-modified stamp. */
interface DevFile {
  contents: string
  modifiedMs: number
}

/**
 * The dev bridge's filesystem: a plain in-memory map of graph-relative paths
 * to markdown, standing in for the Rust shell's `fs` commands. Mutations stamp
 * `modifiedMs` with the current time so recency sorts and the indexer's
 * hash-reconcile behave like real files.
 */
export interface DevFileStore {
  /** Every eligible Markdown note anywhere in the graph (`list_files`). */
  list: () => FileMeta[]
  /** Files under a graph-relative directory prefix (the `dir_list` view). */
  listDir: (dir: string) => FileMeta[]
  /** A note's markdown, or `null` when the path doesn't exist. */
  read: (path: string) => string | null
  exists: (path: string) => boolean
  /** Write a file and return the `modifiedMs` it was stamped with (the
   * `note_write` contract: the caller's index echo carries this stamp). */
  write: (path: string, contents: string) => number
  /** Create a file only when its path is free; never replaces existing bytes. */
  create: (path: string, contents: string) => NoteCreateOutcome
  /** Delete a path; a missing path is a no-op (mirrors trashing semantics). */
  remove: (path: string) => void
  /** Rename a file; refuses (returns false) when the destination exists. */
  move: (from: string, to: string) => boolean
  /** List visible folders (derived from files + explicitly created empty folders). */
  listFolders: () => string[]
  /** Create an empty folder; returns false when it already exists. */
  createFolder: (path: string) => boolean
  /** Move/rename a folder and every file inside it; returns false on missing/collision. */
  moveFolder: (from: string, to: string) => boolean
  /** Delete a folder and every file inside it; returns false when missing. */
  removeFolder: (path: string) => boolean
}

/** UTF-8 byte length — `FileMeta.size` parity with the Rust listing. */
function byteSize(contents: string): number {
  return new TextEncoder().encode(contents).length
}

/**
 * Create the in-memory file store, pre-populated with `seed` (path →
 * markdown). Seeded files get staggered past mtimes so recency ordering is
 * visibly non-uniform in list surfaces.
 */
export function createDevFileStore(seed: Record<string, string>): DevFileStore {
  const files = new Map<string, DevFile>()
  const emptyFolders = new Set<string>()
  const seedEntries = Object.entries(seed)
  for (const [position, [path, contents]] of seedEntries.entries()) {
    // Older seeds get older stamps, one minute apart, ending "now".
    const modifiedMs = Date.now() - (seedEntries.length - position) * 60_000
    files.set(path, { contents, modifiedMs })
  }

  const allFolders = (): Set<string> => {
    const folders = new Set<string>()
    const addAncestors = (folderPath: string): void => {
      const parts = folderPath.split('/').filter((part) => part !== '')
      if (parts.length === 0) {
        return
      }
      if (
        parts[0] === 'assets' ||
        parts[0] === 'audio-memos' ||
        parts.some((part) => part.startsWith('.'))
      ) {
        return
      }
      let current = ''
      for (const part of parts) {
        current = current === '' ? part : `${current}/${part}`
        folders.add(current)
      }
    }
    for (const dir of emptyFolders) {
      addAncestors(dir)
    }
    for (const filePath of files.keys()) {
      const slash = filePath.lastIndexOf('/')
      if (slash > 0) {
        addAncestors(filePath.slice(0, slash))
      }
    }
    return folders
  }

  const toMeta = ([path, file]: [string, DevFile]): FileMeta => ({
    path,
    size: byteSize(file.contents),
    modifiedMs: file.modifiedMs,
  })

  return {
    list: () => [...files].filter(([path]) => isNotePath(path)).map(toMeta),
    listDir: (dir) => {
      const prefix = dir.endsWith('/') ? dir : `${dir}/`
      return [...files].filter(([path]) => path.startsWith(prefix)).map(toMeta)
    },
    read: (path) => files.get(path)?.contents ?? null,
    exists: (path) => files.has(path),
    write: (path, contents) => {
      const modifiedMs = Date.now()
      files.set(path, { contents, modifiedMs })
      return modifiedMs
    },
    create: (path, contents) => {
      if (files.has(path)) {
        return { kind: 'collision' }
      }
      const modifiedMs = Date.now()
      files.set(path, { contents, modifiedMs })
      return { kind: 'created', modifiedMs }
    },
    remove: (path) => {
      files.delete(path)
    },
    move: (from, to) => {
      const file = files.get(from)
      if (file === undefined || files.has(to)) {
        return false
      }
      files.delete(from)
      files.set(to, file)
      return true
    },
    listFolders: () => [...allFolders()].sort(),
    createFolder: (path) => {
      if (allFolders().has(path)) {
        return false
      }
      emptyFolders.add(path)
      return true
    },
    moveFolder: (from, to) => {
      const folders = allFolders()
      if (!folders.has(from) || to === from || to.startsWith(`${from}/`)) {
        return false
      }
      if (folders.has(to) && from.toLowerCase() !== to.toLowerCase()) {
        return false
      }
      const prefix = `${from}/`
      const movedFiles: [string, DevFile][] = []
      for (const [path, file] of files) {
        if (path.startsWith(prefix)) {
          movedFiles.push([`${to}/${path.slice(prefix.length)}`, file])
        }
      }
      for (const [oldPath] of files) {
        if (oldPath.startsWith(prefix)) {
          files.delete(oldPath)
        }
      }
      for (const [path, file] of movedFiles) {
        files.set(path, file)
      }
      const movedDirs: string[] = []
      for (const dir of emptyFolders) {
        if (dir === from || dir.startsWith(prefix)) {
          movedDirs.push(dir === from ? to : `${to}/${dir.slice(prefix.length)}`)
        }
      }
      for (const dir of emptyFolders) {
        if (dir === from || dir.startsWith(prefix)) {
          emptyFolders.delete(dir)
        }
      }
      for (const dir of movedDirs) {
        emptyFolders.add(dir)
      }
      if (movedFiles.length === 0) {
        emptyFolders.add(to)
      }
      return true
    },
    removeFolder: (path) => {
      const folders = allFolders()
      if (!folders.has(path)) {
        return false
      }
      const prefix = `${path}/`
      for (const filePath of files.keys()) {
        if (filePath.startsWith(prefix)) {
          files.delete(filePath)
        }
      }
      for (const dir of emptyFolders) {
        if (dir === path || dir.startsWith(prefix)) {
          emptyFolders.delete(dir)
        }
      }
      return true
    },
  }
}
