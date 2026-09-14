import { createContext, use, type ReactElement } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { zoneDropId } from '@/lib/tab-drop'
import { cn } from '@/lib/utils'
import type { DropZone } from '@/providers/panes-provider'

/**
 * Whether a tab is being dragged anywhere in the workspace frame. The frame's
 * `DndContext` provides it; the default keeps a pane rendered outside the
 * frame (the note window, tests) free of drop zones.
 */
export const PaneDragContext = createContext<{ dragging: boolean }>({ dragging: false })

interface PaneDropZonesProps {
  paneId: string
}

/**
 * The three regions a dragged tab can land on, over one pane's card: the
 * whole card takes the tab into this pane's strip, the right quarter and the
 * bottom 40% open a new pane beside or under it. They exist only while a drag
 * is in flight — an always-mounted overlay would swallow every click meant
 * for the editor underneath, and a droppable registered before its element
 * exists is measured as nothing and never wins a collision.
 */
export function PaneDropZones({ paneId }: PaneDropZonesProps): ReactElement | null {
  const { dragging } = use(PaneDragContext)
  if (!dragging) {
    return null
  }
  // The edge zones sit over the centre one and win the collision, so the
  // centre only has to cover the card.
  return (
    <div data-testid="pane-drop-zones" className="absolute inset-0 z-20">
      <PaneDropZone paneId={paneId} zone="center" className="absolute inset-0 rounded-xl" />
      <PaneDropZone
        paneId={paneId}
        zone="below"
        className="absolute inset-x-0 bottom-0 h-2/5 rounded-b-xl"
      />
      <PaneDropZone
        paneId={paneId}
        zone="right"
        className="absolute inset-y-0 right-0 w-1/4 rounded-r-xl"
      />
    </div>
  )
}

interface PaneDropZoneProps {
  paneId: string
  zone: DropZone
  className: string
}

/** One region, tinted while the pointer is inside it. */
function PaneDropZone({ paneId, zone, className }: PaneDropZoneProps): ReactElement {
  const id = zoneDropId(paneId, zone)
  const { isOver, setNodeRef } = useDroppable({ id, data: { kind: 'zone', paneId, zone } })
  return (
    <div
      ref={setNodeRef}
      data-testid={id}
      className={cn(className, isOver && 'bg-accent/10 ring-1 ring-accent')}
    />
  )
}
