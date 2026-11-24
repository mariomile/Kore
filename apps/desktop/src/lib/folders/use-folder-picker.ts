import { useMemo, useState } from 'react'
import { errorMessage } from '@kore/core'
import { useFolderTree } from '@/hooks/use-folder-tree'
import { flattenFolders, pickFolders, type FolderPick } from '@/lib/folders/folder-options'
import { useFolderOperations, type MoveTarget } from '@/lib/folders/use-folder-operations'
import { folderOf } from '@/lib/notes/use-note-bulk-actions'
import { startOperation } from '@/lib/operations'

export interface FolderPicker extends FolderPick {
  query: string
  setQuery: (query: string) => void
  /** Where the target sits now, checked in the list; `''` is the vault root. */
  current: string
  /**
   * Move the target into `destination` (creating it when it's new). The
   * picker closes first; a failure surfaces in the operations toast.
   */
  choose: (destination: string) => void
}

/**
 * The state behind both Move to… pickers (the Mac dialog, the iPhone sheet):
 * the vault's folders narrowed by the typed query, the target's own folder,
 * and a new folder when the typed path names none. A folder never lists
 * itself or its subfolders as a destination.
 */
export function useFolderPicker(target: MoveTarget | null): FolderPicker {
  const tree = useFolderTree()
  const [query, setQuery] = useState('')
  const exclude = target?.kind === 'folder' ? target.path : null
  const options = useMemo(
    () => (tree === null ? [] : flattenFolders(tree, exclude)),
    [tree, exclude],
  )
  const pick = useMemo(() => pickFolders(options, query), [options, query])
  const { moveTo } = useFolderOperations()
  const choose = (destination: string): void => {
    setQuery('')
    if (target === null) {
      return
    }
    // A note's move reports through its own batch toast; a folder's here.
    moveTo(target, destination).catch((cause: unknown) => {
      startOperation('Moving folder').fail(errorMessage(cause))
    })
  }
  return {
    ...pick,
    query,
    setQuery,
    current: target === null ? '' : folderOf(target.path),
    choose,
  }
}
