import { Fragment, type ReactElement, type ReactNode } from 'react'
import { folderDisplayName, folderParentCrumbs, foldCrumbs } from '@kore/core'
import { ChevronRight, Folder } from '@/components/icons'
import { cn } from '@/lib/utils'
import { useRouter } from '@/routing/router'

/** Past this many parents the middle ones fold into an ellipsis. */
const MAX_VISIBLE_PARENTS = 2

interface FolderPathTitleProps {
  /** Graph-relative folder path, the page's identity. */
  folder: string
  /** The heading, when it isn't the folder's own name (iPhone's top level). */
  name?: string
  /** Layout extras from the screen (spacing); the type is the component's. */
  className?: string
  /** Shown after the folder's name, on the same line (the iPhone count). */
  trailing?: ReactNode
}

/**
 * A folder page's title as one line: `📁 Active › Goals`. The parents sit at
 * the same size as the folder itself, so the page reads as a place in the
 * vault (Mario, 2026-11-27: "tutto rimane sulla linea"), at the lead UI
 * heading size rather than a page title's so the whole path fits one line
 * ("deve rimanere sempre su una riga"). Only tone tells them apart: parents
 * muted and each opening its own folder page, the current folder in full
 * ink as the heading. A deep path keeps the first parent and the nearest,
 * folding the rest into `…`, and the folder's own name keeps its room before
 * any parent does. Shared by the Mac header and the iPhone folder screen.
 */
export function FolderPathTitle({
  folder,
  name = folderDisplayName(folder),
  className,
  trailing,
}: FolderPathTitleProps): ReactElement {
  const { navigate } = useRouter()
  const parents = foldCrumbs(folderParentCrumbs(folder), MAX_VISIBLE_PARENTS)

  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-1.5 text-xl font-semibold tracking-tight',
        className,
      )}
    >
      <Folder aria-hidden className="size-5 flex-none text-text-muted" />
      {parents.length > 0 ? (
        <nav aria-label="Parent folders" className="flex min-w-0 shrink items-center">
          <ol className="flex min-w-0 items-center gap-1">
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
                      className="relative max-w-[14rem] min-w-0 truncate text-text-muted transition-colors duration-150 after:absolute after:-inset-y-3 after:inset-x-0 after:content-[''] hover:text-text-secondary focus-visible:text-text-secondary focus-visible:outline-none"
                    >
                      {crumb.name}
                    </button>
                  )}
                </li>
                <li aria-hidden className="flex flex-none items-center text-text-muted">
                  <ChevronRight className="size-4" />
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
