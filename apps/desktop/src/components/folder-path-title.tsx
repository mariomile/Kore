import { Fragment, type ReactElement, type ReactNode } from 'react'
import { folderDisplayName, folderParentCrumbs, foldCrumbs } from '@kore/core'
import { ChevronRight, Folder } from '@/components/icons'
import { cn } from '@/lib/utils'
import { useRouter } from '@/routing/router'

interface FolderPathTitleProps {
  /** Graph-relative folder path, the page's identity. */
  folder: string
  /** The heading, when it isn't the folder's own name (iPhone's top level). */
  name?: string
  /** The headline type of the screen: every crumb shares it. */
  className: string
  /**
   * How many parent folders stay visible before the middle folds into `…`:
   * the Mac keeps the first and the nearest, iPhone's narrow line only the
   * nearest.
   */
  maxParents: number
  /** Shown after the folder's name, on the same line (the iPhone count). */
  trailing?: ReactNode
}

/**
 * A folder page's title as one line: `📁 Active › Goals`. The parents sit at
 * the same size as the folder itself, so the page reads as a place in the
 * vault (Mario, 2026-11-27: "tutto rimane sulla linea"); only tone tells them
 * apart: parents muted and each opening its own folder page, the current
 * folder in full ink as the page's heading. A deep path folds its middle
 * into `…` (see `maxParents`), and the folder's own name keeps its room
 * before any parent does. Shared by the Mac header and the iPhone folder
 * screen.
 */
export function FolderPathTitle({
  folder,
  name = folderDisplayName(folder),
  className,
  maxParents,
  trailing,
}: FolderPathTitleProps): ReactElement {
  const { navigate } = useRouter()
  const parents = foldCrumbs(folderParentCrumbs(folder), maxParents)

  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      <Folder aria-hidden className="size-6 flex-none text-text-muted" />
      {parents.length > 0 ? (
        <nav aria-label="Parent folders" className="flex min-w-0 shrink items-center">
          <ol className="flex min-w-0 items-center gap-1.5">
            {parents.map((crumb) => (
              <Fragment key={crumb?.path ?? 'folded'}>
                <li
                  className={cn(
                    'flex items-center',
                    crumb === null ? 'flex-none' : 'min-w-[1.5em] shrink',
                  )}
                >
                  {crumb === null ? (
                    <span title={folder} className="text-text-muted">
                      …
                    </span>
                  ) : (
                    <button
                      type="button"
                      title={crumb.path}
                      onClick={() => {
                        navigate({
                          kind: 'allNotes',
                          filter: { kind: 'folder', folder: crumb.path },
                        })
                      }}
                      className="relative max-w-[14rem] min-w-0 truncate text-text-muted transition-colors duration-150 after:absolute after:-inset-y-1.5 after:inset-x-0 after:content-[''] hover:text-text-secondary focus-visible:text-text-secondary focus-visible:outline-none"
                    >
                      {crumb.name}
                    </button>
                  )}
                </li>
                <li aria-hidden className="flex flex-none items-center text-text-muted">
                  <ChevronRight className="size-5" />
                </li>
              </Fragment>
            ))}
          </ol>
        </nav>
      ) : null}
      <h1 className="max-w-[70%] min-w-0 flex-none truncate text-text">{name}</h1>
      {trailing}
    </div>
  )
}
