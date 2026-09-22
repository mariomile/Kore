import { useId, useState, type ReactElement } from 'react'
import { ArrowUturnRight } from '@/components/icons'
import { useNoteLinkNavigation } from '@/hooks/use-note-link-navigation'
import { useSimilarNotes } from '@/lib/use-similar-notes'
import { routeForPath } from '@/routing/route'
import { SidebarSection } from './sidebar-section'
import { isModEvent } from '@meowdown/core'

interface SimilarNotesSectionProps {
  /** Graph-relative path of the note whose semantic neighbors to show. */
  path: string
}

/**
 * "Similar notes" as a compact context-sidebar section: one collapsed title
 * per neighbor with a flipped return-arrow on the right. Focusing or hovering
 * a row reveals the heading and passage already returned by retrieval. Rows
 * use the same horizontal inset as the Published URL section. Neighbors of
 * `path` are seeded by the note's stored chunk vectors. Renders nothing at all
 * when there are no results — semantic search may be disabled or the note not
 * yet embedded, and an empty box would just advertise a missing feature. Query
 * errors are deliberately just as quiet: a failing semantic leg means an
 * optional feature is unavailable, not that the index is broken. Shared by the
 * daily and note context sidebars.
 */
export function SimilarNotesSection({ path }: SimilarNotesSectionProps): ReactElement | null {
  const navigateNoteLink = useNoteLinkNavigation()
  const related = useSimilarNotes(path)
  const [focusedPath, setFocusedPath] = useState<string | null>(null)
  const [hoveredPath, setHoveredPath] = useState<string | null>(null)
  const previewId = useId()
  if (related.length === 0) {
    return null
  }

  return (
    <SidebarSection storageKey="similar" title="Similar notes">
      <ul className="space-y-1">
        {related.map((hit, index) => {
          const previewVisible = focusedPath === hit.path || hoveredPath === hit.path
          const passageId = `${previewId}-${index}`
          return (
            <li key={hit.path}>
              <button
                type="button"
                aria-label={hit.title}
                aria-describedby={previewVisible ? passageId : undefined}
                onFocus={() => setFocusedPath(hit.path)}
                onBlur={() => setFocusedPath((current) => (current === hit.path ? null : current))}
                onMouseEnter={() => setHoveredPath(hit.path)}
                onMouseLeave={() =>
                  setHoveredPath((current) => (current === hit.path ? null : current))
                }
                onClick={(event) =>
                  navigateNoteLink({
                    target: routeForPath(hit.path),
                    openInSplit: isModEvent(event),
                  })
                }
                className="flex w-full items-start space-x-1 rounded-md px-3 py-1 leading-5 text-text-secondary transition-colors duration-100 hover:bg-surface-hover hover:text-text"
              >
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-xs font-medium">{hit.title}</span>
                  {previewVisible ? (
                    <span id={passageId} className="mt-1 block text-xs leading-4 text-text-muted">
                      {hit.heading === null ? null : (
                        <span className="mb-0.5 block truncate font-medium text-text-secondary">
                          {hit.heading}
                        </span>
                      )}
                      <span className="line-clamp-3">{hit.snippet}</span>
                    </span>
                  ) : null}
                </span>
                <ArrowUturnRight aria-hidden size={13} className="mt-1 flex-none" />
              </button>
            </li>
          )
        })}
      </ul>
    </SidebarSection>
  )
}
