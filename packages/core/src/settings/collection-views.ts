import type { SavedCollectionView } from './schema-collections'

/** Which way a keyboard move nudges a collection view tab. */
export type CollectionViewMoveDirection = 'left' | 'right'

/**
 * Drops the saved view `id` into the slot `targetId` occupies, shifting the
 * views in between (a drag-and-drop landing). Returns the reordered list, or
 * `null` when nothing changes — either id is missing or they are the same —
 * so callers can skip a pointless persist.
 */
export function moveSavedCollectionView(
  views: readonly SavedCollectionView[],
  id: string,
  targetId: string,
): SavedCollectionView[] | null {
  const from = views.findIndex((view) => view.id === id)
  const to = views.findIndex((view) => view.id === targetId)
  if (from === -1 || to === -1 || from === to) {
    return null
  }
  const next = [...views]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved!)
  return next
}

/**
 * Swaps the saved view `id` with its neighbour on `direction`'s side (a
 * keyboard move). Returns `null` at the strip's edge or for an unknown id.
 */
export function shiftSavedCollectionView(
  views: readonly SavedCollectionView[],
  id: string,
  direction: CollectionViewMoveDirection,
): SavedCollectionView[] | null {
  const index = views.findIndex((view) => view.id === id)
  if (index === -1) {
    return null
  }
  const neighbour = views[direction === 'left' ? index - 1 : index + 1]
  return neighbour === undefined ? null : moveSavedCollectionView(views, id, neighbour.id)
}
