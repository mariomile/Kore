import { Fragment, type ReactElement } from 'react'
import { noteFolderCrumbs, type FolderCrumb } from '@kore/core'
import { ChevronRight, Folder } from '@/components/icons'
import { cn } from '@/lib/utils'
import { useRouter } from '@/routing/router'

interface NoteFolderBreadcrumbProps {
  /** Graph-relative path of the open note. */
  path: string
  /** Additional classes applied to the nav. */
  className?: string
}

/** Past this many folders the middle ones fold into an ellipsis. */
const MAX_VISIBLE_CRUMBS = 3

const CRUMB_CLASS =
  'flex max-w-[12rem] min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-left transition-colors hover:bg-surface-hover hover:text-text focus-visible:bg-surface-hover focus-visible:text-text focus-visible:outline-none'

/**
 * Where the note lives, above its title: `📁 Active › Projects ›`. Kore
 * organizes with folders and tags only (Mario, 2026-11-22), so this is the
 * folder path and nothing else; each crumb opens that folder (the folder
 * page on the Mac, the Notes tab filtered to it on iPhone). A deep path
 * keeps the first folder and the last two, with the rest folded into `…`.
 * Renders nothing at the vault root or in Kore's own `notes/`.
 */
export function NoteFolderBreadcrumb({
  path,
  className,
}: NoteFolderBreadcrumbProps): ReactElement | null {
  const { navigate } = useRouter()
  const crumbs = noteFolderCrumbs(path)
  if (crumbs.length === 0) {
    return null
  }

  const folded = crumbs.length > MAX_VISIBLE_CRUMBS
  const visible: (FolderCrumb | null)[] = folded
    ? [crumbs[0]!, null, ...crumbs.slice(-(MAX_VISIBLE_CRUMBS - 1))]
    : crumbs
  const fullPath = crumbs.at(-1)!.path

  return (
    <nav aria-label="Folder" className={cn('mb-1.5', className)}>
      <ol className="-ml-1.5 flex min-w-0 items-center gap-0.5 text-xs text-text-muted">
        {visible.map((crumb, index) => (
          <Fragment key={crumb?.path ?? 'folded'}>
            <li className="flex min-w-0 items-center">
              {crumb === null ? (
                <span title={fullPath} className="px-1">
                  …
                </span>
              ) : (
                <button
                  type="button"
                  title={crumb.path}
                  onClick={() => {
                    navigate({ kind: 'allNotes', filter: { kind: 'folder', folder: crumb.path } })
                  }}
                  className={CRUMB_CLASS}
                >
                  {index === 0 ? <Folder aria-hidden className="size-3.5 shrink-0" /> : null}
                  <span className="truncate">{crumb.name}</span>
                </button>
              )}
            </li>
            <li aria-hidden className="flex shrink-0 items-center">
              <ChevronRight className="size-3" />
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  )
}
