import { useState, type ReactElement } from 'react'
import { ChevronRight } from '@/components/icons'
import { useBacklinkNavigation } from '@/hooks/use-backlink-navigation'
import { useNoteChildren } from '@/hooks/use-note-hierarchy'
import { cn } from '@/lib/utils'

/** Rows shown before "Show all": a big MOC must not bury the backlinks below it. */
const COLLAPSED_CHILD_LIMIT = 20

interface NoteChildrenPanelProps {
  /** Graph-relative path of the note whose children to list. */
  path: string
  /** Additional classes applied to the section. */
  className?: string
}

/**
 * The notes whose `up:` names this one, above the backlinks: a MOC's
 * contents without writing them by hand. Titles only, by title; the first
 * {@link COLLAPSED_CHILD_LIMIT} show until "Show all", and the header
 * collapses the list. Renders nothing when no note points up here. Shared
 * by the desktop pane and the mobile note screen.
 */
export function NoteChildrenPanel({
  path,
  className,
}: NoteChildrenPanelProps): ReactElement | null {
  const children = useNoteChildren(path)
  const [expanded, setExpanded] = useState(true)
  const [showAll, setShowAll] = useState(false)
  const { openSource } = useBacklinkNavigation()

  if (children.length === 0) {
    return null
  }

  return (
    <section aria-label="Child notes" className={cn('mt-8', className)}>
      <h3 className="text-xs font-medium text-text-muted">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded(!expanded)
          }}
          className="flex w-full items-center gap-2 text-left"
        >
          <ChevronRight
            aria-hidden
            className={`size-3 shrink-0 text-text-muted transition-transform ${
              expanded ? 'rotate-90' : ''
            }`}
          />
          <span>
            Child note{children.length === 1 ? '' : 's'} ({children.length})
          </span>
        </button>
      </h3>

      {expanded ? (
        <ul className="mt-3 flex flex-col pl-5">
          {(showAll ? children : children.slice(0, COLLAPSED_CHILD_LIMIT)).map((child) => (
            <li key={`${path}:${child.path}`}>
              <button
                type="button"
                onClick={(event) => {
                  openSource(child.path, event)
                }}
                className="-ml-2 block w-[calc(100%+0.5rem)] truncate rounded-md px-2 py-1 text-left text-sm text-text hover:bg-surface-hover hover:text-accent"
              >
                {child.title}
              </button>
            </li>
          ))}
          {!showAll && children.length > COLLAPSED_CHILD_LIMIT ? (
            <li>
              <button
                type="button"
                onClick={() => {
                  setShowAll(true)
                }}
                className="-ml-2 mt-1 rounded-md px-2 py-1 text-left text-xs text-text-muted hover:bg-surface-hover hover:text-text"
              >
                Show all {children.length}
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </section>
  )
}
