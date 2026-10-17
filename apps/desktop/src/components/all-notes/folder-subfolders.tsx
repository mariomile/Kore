import type { ReactElement } from 'react'
import type { FolderTreeFolder } from '@reflect/core'
import { Folder } from '@/components/icons'
import { useRouter } from '@/routing/router'

interface FolderSubfoldersProps {
  /** The page's folder from the tree; renders nothing without subfolders. */
  folder: FolderTreeFolder | null
}

/**
 * A folder page's subfolders as chips above its notes — Notion's child
 * pages. Each opens that subfolder's own page; the count is every note
 * below it.
 */
export function FolderSubfolders({ folder }: FolderSubfoldersProps): ReactElement | null {
  const { navigate } = useRouter()
  if (folder === null || folder.folders.length === 0) {
    return null
  }
  return (
    <ul aria-label="Subfolders" className="flex flex-none flex-wrap gap-2 pb-4 pl-12 pr-7">
      {folder.folders.map((child) => (
        <li key={child.path}>
          <button
            type="button"
            onClick={() =>
              navigate({ kind: 'allNotes', filter: { kind: 'folder', folder: child.path } })
            }
            className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-sm text-text-secondary transition-colors hover:bg-surface-hover hover:text-text"
          >
            <Folder aria-hidden className="size-3.5 flex-none text-text-muted" />
            <span className="max-w-48 truncate">{child.name}</span>
            <span className="text-2xs tabular-nums text-text-muted">{child.noteCount}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
