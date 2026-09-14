import { closestCenter, pointerWithin, type CollisionDetection } from '@dnd-kit/core'

/**
 * Where a dragged tab lands. A pane's `right`/`below` zone beats its centre,
 * and any zone beats a tab pill underneath: the dragged pill follows the
 * pointer, so it would otherwise win every collision over a card. A pointer
 * still inside some droppable but in no zone is over a pill, and falls back
 * to `closestCenter`, which is what reordering a strip wants. A pointer
 * inside nothing at all is a drag abandoned over the sidebar, a resize
 * handle or the gutter: it must resolve to no target, or `closestCenter`
 * would hand it the nearest pane and move the tab there.
 */
export function tabDropCollision(
  args: Parameters<CollisionDetection>[0],
): ReturnType<CollisionDetection> {
  const within = pointerWithin(args)
  const zones = within.filter((hit) => String(hit.id).startsWith('zone:'))
  const edge = zones.filter((hit) => !String(hit.id).endsWith(':center'))
  if (edge.length > 0) {
    return edge
  }
  if (zones.length > 0) {
    return zones
  }
  if (within.length === 0) {
    return []
  }
  return closestCenter(args)
}
