import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { errorMessage, typeFoldersForNote } from '@kore/core'
import { useFolderTree } from '@/hooks/use-folder-tree'
import {
  flattenFolders,
  pickFolders,
  suggestFolders,
  type FolderOption,
  type FolderPick,
} from '@/lib/folders/folder-options'
import {
  recentMoveDestinations,
  rememberMoveDestination,
} from '@/lib/folders/recent-move-destinations'
import { useFolderOperations, type MoveTarget } from '@/lib/folders/use-folder-operations'
import { folderOf } from '@/lib/notes/use-note-bulk-actions'
import { startOperation } from '@/lib/operations'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'

export interface FolderPicker extends FolderPick {
  query: string
  setQuery: (query: string) => void
  /** Where the target sits now, checked in the list; `''` is the vault root. */
  current: string
  /**
   * One-tap destinations above the list while nothing is typed: the note's
   * type folders, then this device's latest destinations.
   */
  suggestions: readonly FolderOption[]
  /**
   * Move the target into `destination` (creating it when it's new). The
   * picker closes first; a failure surfaces in the operations toast.
   */
  choose: (destination: string) => void
}

const NO_FOLDERS: readonly string[] = []

/**
 * The state behind both Move to… pickers (the Mac dialog, the iPhone sheet):
 * the vault's folders narrowed by the typed query, the target's own folder,
 * suggestions, and a new folder when the typed path names none. A folder
 * never lists itself or its subfolders as a destination.
 */
export function useFolderPicker(target: MoveTarget | null): FolderPicker {
  const tree = useFolderTree()
  const { graph } = useGraph()
  const [query, setQuery] = useState('')
  const exclude = target?.kind === 'folder' ? target.path : null
  const current = target === null ? '' : folderOf(target.path)
  const options = useMemo(
    () => (tree === null ? [] : flattenFolders(tree, exclude)),
    [tree, exclude],
  )
  const pick = useMemo(() => pickFolders(options, query), [options, query])
  const notePath = target?.kind === 'note' ? target.path : null
  const { data: typeFolders = NO_FOLDERS } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'type-folders', notePath],
    queryFn: () => typeFoldersForNote(notePath!),
    enabled: notePath !== null && graph !== null && graph !== undefined,
  })
  // Read once per target: the list must not reshuffle under the finger.
  const recent = useMemo(() => (target === null ? [] : recentMoveDestinations()), [target])
  const suggestions = useMemo(
    () => suggestFolders([...typeFolders, ...recent], current, exclude),
    [typeFolders, recent, current, exclude],
  )
  const { moveTo } = useFolderOperations()
  const choose = (destination: string): void => {
    setQuery('')
    if (target === null) {
      return
    }
    rememberMoveDestination(destination)
    // A note's move reports through its own batch toast; a folder's here.
    moveTo(target, destination).catch((cause: unknown) => {
      startOperation('Moving folder').fail(errorMessage(cause))
    })
  }
  return {
    ...pick,
    query,
    setQuery,
    current,
    suggestions,
    choose,
  }
}
