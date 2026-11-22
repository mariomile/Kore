import { Fragment, type ReactElement } from 'react'
import { displayNoteTitle } from '@kore/core'
import { ChevronRight, Note } from '@/components/icons'
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
 * `Home › PKM ›`. Each crumb carries the note glyph so it reads as a parent
 * *note*, never as the folder the file sits in (folders draw the folder
 * glyph everywhere else), and its tooltip names the relation. The trailing
 * chevron points at the title below. Each crumb opens that note (⌘-click
 * beside this one). Renders nothing when the note declares no parent.
 */
export function NoteBreadcrumb({ path, className }: NoteBreadcrumbProps): ReactElement | null {
  const ancestors = useNoteAncestors(path)
  const { openSource } = useBacklinkNavigation()

  if (ancestors.length === 0) {
    return null
  }

  return (
    <nav aria-label="Parent notes" className={cn('mb-1.5', className)}>
      <ol className="-ml-1.5 flex min-w-0 flex-wrap items-center gap-0.5 text-xs text-text-muted">
        {ancestors.map((note) => (
          <Fragment key={note.path}>
            <li className="min-w-0">
              <button
                type="button"
                title={`Parent note: ${displayNoteTitle(note.title)}`}
                onClick={(event) => {
                  openSource(note.path, event)
                }}
                className="flex max-w-[16rem] items-center gap-1 rounded-md px-1.5 py-0.5 text-left transition-colors hover:bg-surface-hover hover:text-text focus-visible:bg-surface-hover focus-visible:text-text focus-visible:outline-none"
              >
                <Note aria-hidden className="size-3.5 shrink-0" />
                <span className="truncate">{displayNoteTitle(note.title)}</span>
              </button>
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
