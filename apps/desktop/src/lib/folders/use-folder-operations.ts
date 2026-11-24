import { useCallback } from 'react'
import {
  collectFolderNotePaths,
  createFolder,
  createNoteWithSource,
  findFolder,
  folderDisplayName,
  newNoteSource,
} from '@kore/core'
import { useFolderTree } from '@/hooks/use-folder-tree'
import {
  deleteFolderCarryingIndex,
  moveFolderCarryingSessions,
  retargetFolderRoute,
  routeIsInsideFolder,
} from '@/lib/folders/folder-actions'
import { folderOf, useNoteBulkActions } from '@/lib/notes/use-note-bulk-actions'
import { startOperation } from '@/lib/operations'
import { invalidateIndexQueries } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'
import { routeForPath } from '@/routing/route'
import { useRouter } from '@/routing/router'

/** What a Move to… picker moves: one note, or a whole folder. */
export type MoveTarget =
  | { readonly kind: 'note'; readonly path: string }
  | { readonly kind: 'folder'; readonly path: string }

function joinFolder(parent: string, name: string): string {
  return parent === '' ? name : `${parent}/${name}`
}

export interface FolderOperations {
  /** Create a note titled `title` inside `folder` and open it. */
  createNote: (folder: string, title: string) => Promise<void>
  /** Create the folder `name` inside `parent` (`''` is the vault root). */
  createSubfolder: (parent: string, name: string) => Promise<void>
  /** Rename `folder` in place; open routes inside it follow. */
  rename: (folder: string, name: string) => Promise<void>
  /** Move a note or a folder into `destination` (`''` is the vault root). */
  moveTo: (target: MoveTarget, destination: string) => Promise<void>
  /** Move `folder` and everything in it to the Trash. */
  trash: (folder: string) => Promise<void>
}

/**
 * Every folder action the Mac sidebar and the iPhone folder page share. Each
 * works on the real folder on disk and keeps open editors, index rows, path
 * links and the current route in step (`folder-actions.ts`); a rejected
 * promise carries the reason for the caller's dialog to show.
 */
export function useFolderOperations(): FolderOperations {
  const { graph, indexGeneration } = useGraph()
  const { route, navigate } = useRouter()
  const tree = useFolderTree()
  const { move: moveNotes } = useNoteBulkActions()
  const generation = graph?.generation ?? null

  const notePathsIn = useCallback(
    (folder: string): string[] => {
      const node = tree === null ? null : findFolder(tree, folder)
      return node === null ? [] : collectFolderNotePaths(node)
    },
    [tree],
  )

  const relocate = useCallback(
    async (from: string, to: string): Promise<void> => {
      if (generation === null || from === to) {
        return
      }
      await moveFolderCarryingSessions({
        from,
        to,
        notePaths: notePathsIn(from),
        generation,
        indexGeneration,
      })
      const next = retargetFolderRoute(route, from, to)
      if (next !== null) {
        navigate(next)
      }
    },
    [generation, indexGeneration, navigate, notePathsIn, route],
  )

  const createNote = useCallback(
    async (folder: string, title: string): Promise<void> => {
      if (generation === null) {
        return
      }
      const path = await createNoteWithSource(title, newNoteSource(title), generation, folder)
      invalidateIndexQueries()
      navigate(routeForPath(path))
    },
    [generation, navigate],
  )

  const createSubfolder = useCallback(
    async (parent: string, name: string): Promise<void> => {
      if (generation === null) {
        return
      }
      const path = joinFolder(parent, name)
      await createFolder(path, generation)
      invalidateIndexQueries()
      startOperation(`Created ${folderDisplayName(path)}`).done()
    },
    [generation],
  )

  const rename = useCallback(
    async (folder: string, name: string): Promise<void> => {
      if (name === folderDisplayName(folder)) {
        return
      }
      await relocate(folder, joinFolder(folderOf(folder), name))
      startOperation(`Renamed folder to ${name}`).done()
    },
    [relocate],
  )

  const moveTo = useCallback(
    async (target: MoveTarget, destination: string): Promise<void> => {
      if (folderOf(target.path) === destination) {
        return
      }
      if (target.kind === 'note') {
        await moveNotes([target.path], destination)
        return
      }
      const name = folderDisplayName(target.path)
      await relocate(target.path, joinFolder(destination, name))
      startOperation(`Moved ${name}`).done()
    },
    [moveNotes, relocate],
  )

  const trash = useCallback(
    async (folder: string): Promise<void> => {
      if (generation === null) {
        return
      }
      await deleteFolderCarryingIndex({
        path: folder,
        notePaths: notePathsIn(folder),
        generation,
        indexGeneration,
      })
      if (routeIsInsideFolder(route, folder)) {
        navigate({ kind: 'allNotes', filter: { kind: 'all' } })
      }
      startOperation(`Moved ${folderDisplayName(folder)} to Trash`).done()
    },
    [generation, indexGeneration, navigate, notePathsIn, route],
  )

  return { createNote, createSubfolder, rename, moveTo, trash }
}
