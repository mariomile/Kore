import { useDndMonitor, type UniqueIdentifier } from '@dnd-kit/core'
import { useRef } from 'react'
import { haptic } from '@/lib/haptics'

/**
 * Haptics for a dnd-kit drag: a lift when the item is picked up, a snap
 * each time it moves over a new place, a drop when it lands somewhere. On
 * the Mac that is the trackpad's alignment knock under the finger, the
 * physical sense of a row or tab clicking into its slot; on the iPhone the
 * same three beats play as medium, selection, light.
 *
 * Render it inside a `DndContext` (it listens through `useDndMonitor`); it
 * renders nothing.
 */
export function DragHaptics(): null {
  const overId = useRef<UniqueIdentifier | null>(null)
  useDndMonitor({
    onDragStart({ active }) {
      // A sortable item starts over its own slot: that is not a move.
      overId.current = active.id
      haptic('lift')
    },
    onDragOver({ over }) {
      const next = over?.id ?? null
      if (next !== null && next !== overId.current) {
        haptic('snap')
      }
      overId.current = next
    },
    onDragEnd({ active, over }) {
      overId.current = null
      if (over !== null && over.id !== active.id) {
        haptic('drop')
      }
    },
    onDragCancel() {
      overId.current = null
    },
  })
  return null
}
