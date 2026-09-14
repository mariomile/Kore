import { closestCenter, pointerWithin, type CollisionDetection } from '@dnd-kit/core'

/**
 * Where a dragged tab lands. A pane's `right`/`below` zone beats its centre,
 * and any zone beats a tab pill underneath — the dragged pill follows the
 * pointer, so it would otherwise win every collision over a card. Pills fall
 * back to `closestCenter`, which is what reordering a strip wants.
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
  return closestCenter(args)
}
