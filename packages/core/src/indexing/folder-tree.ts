import { DAILY_DIR, NOTES_DIR, TAGS_DIR, TEMPLATES_DIR } from '../graph/paths'
import { db } from './db'

/**
 * The vault's folders as a read-only tree of indexed notes — the sidebar's
 * Folders shelf. Built from the index rather than a disk walk, so it shows
 * exactly the notes the rest of the app sees: hidden folders and an Obsidian
 * vault's excluded files never reach the index, and so never reach the tree.
 * Browsing only: nothing here moves, renames or creates anything.
 */

/** One note row in the tree. */
export interface FolderTreeNote {
  readonly path: string
  /** The indexed title (render through `displayNoteTitle`). */
  readonly title: string
}

/** One folder: its subfolders, then its own notes, each alphabetical. */
export interface FolderTreeFolder {
  /** Graph-relative folder path; `''` for the vault root. */
  readonly path: string
  /** The last path segment; `''` for the vault root. */
  readonly name: string
  readonly folders: readonly FolderTreeFolder[]
  readonly notes: readonly FolderTreeNote[]
  /** Notes in this folder and every folder below it. */
  readonly noteCount: number
}

/**
 * Kore's own fixed folders. A vault whose notes live only in these is a
 * Kore-shaped vault — association over hierarchy — and the Folders shelf
 * stays out of its way.
 */
const KORE_FOLDERS = new Set([DAILY_DIR, NOTES_DIR, TEMPLATES_DIR, TAGS_DIR])

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
})

interface MutableFolder {
  path: string
  name: string
  folders: Map<string, MutableFolder>
  notes: FolderTreeNote[]
}

function freeze(folder: MutableFolder): FolderTreeFolder {
  const folders = [...folder.folders.values()]
    .sort((left, right) => collator.compare(left.name, right.name))
    .map(freeze)
  const notes = [...folder.notes].sort(
    (left, right) =>
      collator.compare(left.title, right.title) || collator.compare(left.path, right.path),
  )
  const noteCount = notes.length + folders.reduce((sum, child) => sum + child.noteCount, 0)
  return { path: folder.path, name: folder.name, folders, notes, noteCount }
}

/** Group graph-relative note paths into their folder tree, rooted at the vault. */
export function buildFolderTree(notes: readonly FolderTreeNote[]): FolderTreeFolder {
  const root: MutableFolder = {
    path: '',
    name: '',
    folders: new Map(),
    notes: [],
  }
  for (const note of notes) {
    const segments = note.path.split('/')
    segments.pop()
    let folder = root
    for (const segment of segments) {
      let child = folder.folders.get(segment)
      if (child === undefined) {
        const path = folder.path === '' ? segment : `${folder.path}/${segment}`
        child = { path, name: segment, folders: new Map(), notes: [] }
        folder.folders.set(segment, child)
      }
      folder = child
    }
    folder.notes.push(note)
  }
  return freeze(root)
}

/**
 * Whether the vault keeps notes in folders of its own — anything beyond
 * Kore's fixed `daily/`, `notes/`, `templates/` and `tags/`.
 */
export function hasOwnFolders(tree: FolderTreeFolder): boolean {
  return tree.folders.some((folder) => !KORE_FOLDERS.has(folder.name))
}

/** Every indexed note grouped into the vault's folder tree. */
export async function getFolderTree(): Promise<FolderTreeFolder> {
  const rows = await db.selectFrom('notes').select(['notes.path', 'notes.title']).execute()
  return buildFolderTree(rows)
}
