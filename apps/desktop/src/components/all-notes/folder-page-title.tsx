import type { ReactElement } from 'react'
import { folderDisplayName } from '@kore/core'
import { Folder } from '@/components/icons'
import { FolderCrumbs } from './folder-crumbs'

interface FolderPageTitleProps {
  /** Graph-relative folder path, the page's identity. */
  folder: string
}

/**
 * The folder page's identity: its parent folders as a breadcrumb (each one
 * opens its own page), then the folder's name as the heading at the same
 * display size as "Notes" and a tag page's title.
 */
export function FolderPageTitle({ folder }: FolderPageTitleProps): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <FolderCrumbs segments={folder.split('/').slice(0, -1)} />
      <div className="flex min-w-0 items-center gap-2">
        <Folder aria-hidden className="size-6 flex-none text-text-muted" />
        <h1 className="app-page-title min-w-0 truncate text-text">{folderDisplayName(folder)}</h1>
      </div>
    </div>
  )
}
