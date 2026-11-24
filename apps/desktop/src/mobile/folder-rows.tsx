import type { ReactElement } from 'react'
import type { FolderTreeFolder } from '@kore/core'
import { ChevronRight } from '@/components/icons'
import { folderCountLabel } from '@/components/all-notes/folder-subfolders'
import { FolderRow } from '@/mobile/folder-row'
import { useRouter } from '@/routing/router'

interface FolderRowsProps {
  /** The page's folder from the tree; renders nothing without subfolders. */
  folder: FolderTreeFolder | null
}

/**
 * A folder page's subfolders in the list view on iPhone, the way Files and
 * Notes list folders: one identical row each (icon, name, what it holds,
 * a chevron), so a folder with long note titles never outgrows its
 * neighbours. The grid view shows them as cards instead.
 */
export function FolderRows({ folder }: FolderRowsProps): ReactElement | null {
  const { navigate } = useRouter()
  const children = folder?.folders ?? []
  if (children.length === 0) {
    return null
  }
  return (
    <ul aria-label="Subfolders" className="px-2 pb-2">
      {children.map((child) => (
        <FolderRow
          key={child.path}
          name={child.name}
          detail={folderCountLabel(child)}
          trailing={<ChevronRight aria-hidden className="size-4 shrink-0 text-text-muted" />}
          onPress={() =>
            navigate({ kind: 'allNotes', filter: { kind: 'folder', folder: child.path } })
          }
        />
      ))}
    </ul>
  )
}
