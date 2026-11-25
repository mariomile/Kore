import { Fragment, type ReactElement } from 'react'
import { useRouter } from '@/routing/router'

interface FolderCrumbsProps {
  /** The folders to show, outermost first: each opens its own folder page. */
  segments: readonly string[]
}

/** A path of folders above a page's title, each one opening its folder page. */
export function FolderCrumbs({ segments }: FolderCrumbsProps): ReactElement | null {
  const { navigate } = useRouter()
  if (segments.length === 0) {
    return null
  }
  return (
    <nav aria-label="Parent folders" className="flex min-w-0 items-center gap-1 text-xs">
      {segments.map((name, index) => (
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
  )
}
