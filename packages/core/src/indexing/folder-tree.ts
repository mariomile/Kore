import { listFolders } from '../graph/commands'
import { DAILY_DIR, foldGraphPath, NOTES_DIR, TAGS_DIR, TEMPLATES_DIR } from '../graph/paths'
import { getVaultLayout } from '../graph/vault-layout'
import { db } from './db'
import type { FileChange } from './file-changes'
import { inClauseChunks } from './query-utils'

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

/** Group graph-relative note paths (and optional empty folders on disk) into a folder tree. */
export function buildFolderTree(
  notes: readonly FolderTreeNote[],
  extraFolders: readonly string[] = [],
): FolderTreeFolder {
  const root: MutableFolder = {
    path: '',
    name: '',
    folders: new Map(),
    notes: [],
  }
  const ensureFolder = (segments: readonly string[]): MutableFolder => {
    let folder = root
    for (const segment of segments) {
      if (segment === '') {
        continue
      }
      let child = folder.folders.get(segment)
      if (child === undefined) {
        const path = folder.path === '' ? segment : `${folder.path}/${segment}`
        child = { path, name: segment, folders: new Map(), notes: [] }
        folder.folders.set(segment, child)
      }
      folder = child
    }
    return folder
  }
  for (const dir of extraFolders) {
    ensureFolder(dir.split('/'))
  }
  for (const note of notes) {
    const segments = note.path.split('/')
    segments.pop()
    ensureFolder(segments).notes.push(note)
  }
  return freeze(root)
}

/**
 * Whether `path` is a structural vault folder (`daily`, `weekly`, `tags`,
 * `templates`, `notes`, or the configured Obsidian daily/templates folder)
 * — or an ancestor containing one — matched case-insensitively so APFS
 * casing variants (e.g. `Daily`) stay protected from rename, move, or trash.
 */
export function isProtectedFolder(path: string): boolean {
  const folded = foldGraphPath(path)
  const layout = getVaultLayout()
  const protectedPaths = [
    DAILY_DIR,
    'weekly',
    NOTES_DIR,
    TAGS_DIR,
    TEMPLATES_DIR,
    layout.dailyFolder,
    layout.templatesFolder,
  ]
    .filter((entry) => entry !== '')
    .map(foldGraphPath)
  const prefix = `${folded}/`
  return protectedPaths.some((target) => target === folded || target.startsWith(prefix))
}

/**
 * Validate a single new folder name (no path separators, hidden dot prefix,
 * or traversal segments). Returns a user-facing reason on failure, else `null`.
 */
export function validateFolderName(raw: string): string | null {
  const name = raw.trim()
  if (name === '') {
    return 'Enter a folder name.'
  }
  if (name === '.' || name === '..' || name.startsWith('.')) {
    return 'Folder names cannot start with a dot.'
  }
  if (name.includes('\0') || /[/\\:]/.test(name)) {
    return String.raw`Folder names cannot contain /, \, or :.`
  }
  return null
}

/** Every indexed note path inside `folder` and its subfolders, depth-first. */
export function collectFolderNotePaths(folder: FolderTreeFolder): string[] {
  const paths: string[] = []
  const walk = (node: FolderTreeFolder): void => {
    for (const note of node.notes) {
      paths.push(note.path)
    }
    for (const child of node.folders) {
      walk(child)
    }
  }
  walk(folder)
  return paths
}

/**
 * Whether the vault keeps notes in folders of its own — anything beyond
 * Kore's fixed `daily/`, `notes/`, `templates/` and `tags/`.
 */
export function hasOwnFolders(tree: FolderTreeFolder): boolean {
  return tree.folders.some((folder) => !KORE_FOLDERS.has(folder.name))
}

/** A folder's display name: its last path segment (`CRM/People` → `People`). */
export function folderDisplayName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** The folder at graph-relative `path` in `tree`, or null when no indexed note lives under it. */
export function findFolder(tree: FolderTreeFolder, path: string): FolderTreeFolder | null {
  if (path === '') {
    return tree
  }
  let folder: FolderTreeFolder | undefined = tree
  for (const segment of path.split('/')) {
    folder = folder.folders.find((child) => child.name === segment)
    if (folder === undefined) {
      return null
    }
  }
  return folder
}

/** Every indexed note (plus any empty visible folders on disk) grouped into the vault's folder tree. */
export async function getFolderTree(): Promise<FolderTreeFolder> {
  const [rows, dirs] = await Promise.all([
    db.selectFrom('notes').select(['notes.path', 'notes.title']).execute(),
    listFolders().catch(() => [] as string[]),
  ])
  return buildFolderTree(rows, dirs)
}

/**
 * Whether an applied batch can change `tree`: a removal, a note the tree
 * doesn't hold yet, or a held note whose indexed title moved. The common
 * case, a save that edits a note's body, changes none of them, and skipping
 * the refetch then spares re-reading every note's path and title (thousands
 * of rows) right after each autosave, while the user is typing.
 */
export async function folderTreeAffectedBy(
  tree: FolderTreeFolder,
  changes: readonly FileChange[],
): Promise<boolean> {
  if (changes.some((change) => change.kind !== 'upsert')) {
    return true
  }
  const held = new Map<string, string>()
  for (const change of changes) {
    const title = findNoteTitle(tree, change.path)
    if (title === null) {
      return true
    }
    held.set(change.path, title)
  }
  if (held.size === 0) {
    return false
  }
  let seen = 0
  for (const paths of inClauseChunks([...held.keys()])) {
    const rows = await db
      .selectFrom('notes')
      .where('path', 'in', paths)
      .select(['path', 'title'])
      .execute()
    for (const row of rows) {
      if (held.get(row.path) !== row.title) {
        return true
      }
      seen += 1
    }
  }
  return seen !== held.size // a held note lost its row
}

/** The title `tree` holds for the note at `path`, or null when it holds none. */
function findNoteTitle(tree: FolderTreeFolder, path: string): string | null {
  const slash = path.lastIndexOf('/')
  const folder = findFolder(tree, slash === -1 ? '' : path.slice(0, slash))
  return folder?.notes.find((note) => note.path === path)?.title ?? null
}
