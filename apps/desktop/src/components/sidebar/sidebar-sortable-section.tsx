import type { CSSProperties, ReactElement, ReactNode } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { SidebarSection } from '@reflect/core'
import { cn } from '@/lib/utils'
import { SidebarDisclosure } from './sidebar-disclosure'

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
 * ({@link import('./sidebar-sections').SidebarSections}).
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
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }
  return (
    <div ref={setNodeRef} style={style} className={cn(isDragging && 'relative z-10 opacity-70')}>
      <SidebarDisclosure
        storageKey={id}
        title={title}
        label={label}
        handle={{ ref: setActivatorNodeRef, listeners }}
      >
        {children}
      </SidebarDisclosure>
    </div>
  )
}
