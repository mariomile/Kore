import { createContext, use, type ReactElement, type ReactNode } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import type { SidebarSection } from '@reflect/core'
import { sortableTranslateStyle } from '@/lib/sortable-translate'
import { cn } from '@/lib/utils'
import { SidebarDisclosure } from './sidebar-disclosure'

/**
 * What the shelves list lends each shelf for its header menu: whether it can
 * step up or down among the shelves on screen, and the moves themselves.
 * Provided by {@link import('./sidebar-sections').SidebarSections}; a shelf
 * rendered outside it keeps a plain header.
 */
export interface SidebarShelfArrangement {
  canMove: (id: SidebarSection, direction: 'up' | 'down') => boolean
  move: (id: SidebarSection, direction: 'up' | 'down') => void
  hide: (id: SidebarSection) => void
}

export const SidebarShelfArrangementContext = createContext<SidebarShelfArrangement | null>(null)

interface SidebarSortableSectionProps {
  /** The persisted shelf identity — also its disclosure's storage key. */
  id: SidebarSection
  title: string
  /** Accessible name for the wrapping region (often the same as `title`). */
  label: string
  children: ReactNode
}

/**
 * One shelf of the sidebar's Home surface, draggable into a new position among
 * its siblings. The section header is the handle (no separate grip: the whole
 * row drags, as the pinned rows and tab pills already do), and the drop lands
 * in the `sidebarSections` setting through the list's DndContext
 * ({@link import('./sidebar-sections').SidebarSections}). A "…" on hover
 * offers the same arrangement from the keyboard: Move up, Move down, Hide.
 *
 * A shelf that hides itself while empty simply never mounts, so it holds its
 * place in the stored order without offering an invisible drop target.
 */
export function SidebarSortableSection({
  id,
  title,
  label,
  children,
}: SidebarSortableSectionProps): ReactElement {
  const { isDragging, listeners, setNodeRef, setActivatorNodeRef, transform, transition } =
    useSortable({ id })
  const arrangement = use(SidebarShelfArrangementContext)
  const style = sortableTranslateStyle(transform, transition)
  return (
    <div ref={setNodeRef} style={style} className={cn(isDragging && 'relative z-10 opacity-70')}>
      <SidebarDisclosure
        storageKey={id}
        title={title}
        label={label}
        handle={{ ref: setActivatorNodeRef, listeners }}
        arrangement={
          arrangement === null
            ? undefined
            : {
                canMoveUp: arrangement.canMove(id, 'up'),
                canMoveDown: arrangement.canMove(id, 'down'),
                move: (direction) => {
                  arrangement.move(id, direction)
                },
                hide: () => {
                  arrangement.hide(id)
                },
              }
        }
      >
        {children}
      </SidebarDisclosure>
    </div>
  )
}
