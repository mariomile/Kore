import { Fragment, type ReactElement } from 'react'
import { ChevronRight } from '@/components/icons'
import { useBacklinkNavigation } from '@/hooks/use-backlink-navigation'
import { useNoteAncestors } from '@/hooks/use-note-hierarchy'
import { cn } from '@/lib/utils'

interface NoteBreadcrumbProps {
  /** Graph-relative path of the open note. */
  path: string
  /** Additional classes applied to the nav. */
  className?: string
}

/**
 * The note's place in its `up:` hierarchy, root first, above the title:
 * `Home › PKM`. Each crumb opens that note (⌘-click beside this one).
 * Renders nothing when the note declares no parent.
 */
export function NoteBreadcrumb({ path, className }: NoteBreadcrumbProps): ReactElement | null {
  const ancestors = useNoteAncestors(path)
  const { openSource } = useBacklinkNavigation()

  if (ancestors.length === 0) {
    return null
  }

  return (
    <nav aria-label="Parent notes" className={cn('mb-2', className)}>
      <ol className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-text-muted">
        {ancestors.map((note, index) => (
          <Fragment key={note.path}>
            {index > 0 ? (
              <li aria-hidden className="flex shrink-0 items-center">
                <ChevronRight className="size-3" />
              </li>
            ) : null}
            <li className="min-w-0">
              <button
                type="button"
                title={note.title}
                onClick={(event) => {
                  openSource(note.path, event)
                }}
                className="block max-w-[16rem] truncate rounded-sm text-left transition-colors hover:text-text focus-visible:text-text focus-visible:outline-none"
              >
                {note.title}
              </button>
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  )
}
