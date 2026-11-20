import { join } from '@tauri-apps/api/path'
import {
  deleteFolder,
  errorMessage,
  getPathLinkSources,
  isDaily,
  isProtectedFolder,
  moveFolder,
  moveIndexedRows,
  readNote,
  removeFromIndexBatch,
  rewritePathLinksForMove,
  writeNote,
} from '@kore/core'
import type { NoteSession } from '@/editor/note-session'
import { openSession, retargetOpenDocument } from '@/editor/open-documents'
import { emitNoteMoved } from '@/lib/note-moves'
import { startOperation } from '@/lib/operations'
import { invalidateIndexQueries } from '@/lib/query-client'
import type { Route } from '@/routing/route'

interface MoveFolderOptions {
  readonly from: string
  readonly to: string
  readonly notePaths: readonly string[]
  readonly generation: number
  readonly indexGeneration: number | null
}

/**
 * Rename or move a folder on disk while keeping open editor sessions, SQLite
 * index rows (pins, embeddings, conflicts), explicit path wikilinks, and open
 * routes in sync. Flushes and retargets open editors before the disk rename
 * and rolls them back if the move fails.
 */
export async function moveFolderCarryingSessions({
  from,
  to,
  notePaths,
  generation,
  indexGeneration,
}: MoveFolderOptions): Promise<void> {
  if (from === to) {
    return
  }
  const prefix = `${from}/`
  const movedNotes = notePaths
    .filter((path) => path.startsWith(prefix))
    .map((oldPath) => ({
      from: oldPath,
      to: `${to}/${oldPath.slice(prefix.length)}`,
    }))

  // Flush every open session before retargeting any of them so a flush
  // failure never leaves earlier sessions pointing at the destination path.
  const openSessions: { from: string; to: string; session: NoteSession }[] = []
  for (const { from: oldPath, to: newPath } of movedNotes) {
    const session = openSession(oldPath)
    if (session !== null) {
      await session.flush()
      openSessions.push({ from: oldPath, to: newPath, session })
    }
  }

  for (const item of openSessions) {
    item.session.retarget(item.to)
    retargetOpenDocument(item.from, item.to, item.session)
  }

  try {
    await moveFolder(from, to, generation)
  } catch (cause) {
    for (const item of openSessions) {
      item.session.retarget(item.from)
      retargetOpenDocument(item.to, item.from, item.session)
    }
    throw cause
  }

  if (indexGeneration !== null) {
    for (const { from: oldPath, to: newPath } of movedNotes) {
      try {
        await moveIndexedRows(oldPath, newPath, indexGeneration)
      } catch (cause) {
        console.warn(`folder move: index row move failed for ${oldPath}:`, cause)
      }
    }
  }

  // Rewrite explicit `[[OldFolder/...]]` links after index rows moved so
  // intra-folder links resolve to their new source paths.
  const io = {
    pathLinkSources: getPathLinkSources,
    read: (path: string) => readNote(path, generation),
    write: async (path: string, content: string) => {
      if (openSession(path)?.isDirty() === true) {
        return
      }
      await writeNote(path, content, generation)
    },
  }
  for (const { from: oldPath, to: newPath } of movedNotes) {
    try {
      await rewritePathLinksForMove(oldPath, newPath, io)
    } catch (cause) {
      console.warn(`folder move: path-link rewrite skipped for ${oldPath}:`, cause)
    }
  }

  for (const { from: oldPath, to: newPath } of movedNotes) {
    emitNoteMoved(oldPath, newPath)
  }
  invalidateIndexQueries()
}

interface DeleteFolderOptions {
  readonly path: string
  readonly notePaths: readonly string[]
  readonly generation: number
  readonly indexGeneration: number | null
}

/**
 * Move a folder to the OS trash (or `.kore/trash/` on mobile) and drop its
 * indexed notes from SQLite immediately so the tree and lists show the
 * deletion without waiting on the watcher debounce.
 */
export async function deleteFolderCarryingIndex({
  path,
  notePaths,
  generation,
  indexGeneration,
}: DeleteFolderOptions): Promise<void> {
  if (isProtectedFolder(path) || notePaths.some(isDaily)) {
    throw new Error('Protected and daily-note folders cannot be moved to Trash.')
  }
  await deleteFolder(path, generation)
  // Discard open editor sessions inside the trashed folder AFTER the trash
  // succeeds so unmounting panes never flush and recreate deleted files.
  for (const notePath of notePaths) {
    openSession(notePath)?.discard()
  }
  if (indexGeneration !== null && notePaths.length > 0) {
    try {
      await removeFromIndexBatch(notePaths, indexGeneration)
    } catch (cause) {
      console.warn(`folder delete: index remove failed for ${path}:`, cause)
    }
  }
  invalidateIndexQueries()
}

/** Copy a graph-relative folder's absolute filesystem path to the clipboard. */
export async function runCopyFolderPath(root: string | null, folderPath: string): Promise<void> {
  if (root === null) {
    startOperation('Copying folder path').fail('No vault is open')
    return
  }
  try {
    const absolutePath = await join(root, folderPath)
    await navigator.clipboard.writeText(absolutePath)
    startOperation('Folder path copied').done()
  } catch (cause) {
    startOperation('Copying folder path').fail(errorMessage(cause))
  }
}

/**
 * If `route` is viewing `from` (or a subfolder beneath it), return the updated
 * folder route under `to`; otherwise `null`.
 */
export function retargetFolderRoute(route: Route, from: string, to: string): Route | null {
  if (route.kind !== 'allNotes' || route.filter.kind !== 'folder') {
    return null
  }
  const current = route.filter.folder
  if (current === from) {
    return { kind: 'allNotes', filter: { kind: 'folder', folder: to } }
  }
  if (current.startsWith(`${from}/`)) {
    return {
      kind: 'allNotes',
      filter: { kind: 'folder', folder: `${to}/${current.slice(from.length + 1)}` },
    }
  }
  return null
}

/** Whether `route` points to `folderPath`, a subfolder under it, or a note inside it. */
export function routeIsInsideFolder(route: Route, folderPath: string): boolean {
  const prefix = `${folderPath}/`
  if (route.kind === 'allNotes' && route.filter.kind === 'folder') {
    return route.filter.folder === folderPath || route.filter.folder.startsWith(prefix)
  }
  if (route.kind === 'note') {
    return route.path.startsWith(prefix)
  }
  return false
}
