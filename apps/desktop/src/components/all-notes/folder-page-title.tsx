import { Fragment, type ReactElement } from 'react'
import { folderDisplayName } from '@reflect/core'
import { Folder } from '@/components/icons'
import { useRouter } from '@/routing/router'

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
  const { navigate } = useRouter()
  const segments = folder.split('/')
  const parents = segments.slice(0, -1)
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      {parents.length > 0 ? (
        <nav aria-label="Parent folders" className="flex min-w-0 items-center gap-1 text-xs">
          {parents.map((name, index) => (
            <Fragment key={index}>
              {index > 0 ? <span className="text-text-muted">/</span> : null}
              <button
                type="button"
                onClick={() =>
                  navigate({
                    kind: 'allNotes',
                    filter: { kind: 'folder', folder: segments.slice(0, index + 1).join('/') },
                  })
                }
                className="min-w-0 truncate text-text-muted transition-colors hover:text-text"
              >
                {name}
              </button>
            </Fragment>
          ))}
        </nav>
      ) : null}
      <div className="flex min-w-0 items-center gap-2">
        <Folder aria-hidden className="size-6 flex-none text-text-muted" />
        <h1 className="app-page-title min-w-0 truncate text-text">{folderDisplayName(folder)}</h1>
      </div>
    </div>
  )
}
