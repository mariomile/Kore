import type { CollectionEntry, TagProperty } from '@kore/core'
import type { BoardColumn } from '@/components/all-notes/collection-board'
import { editorSeedList } from '@/components/tags/property-editor-shared'

/** What moving one card into a lane writes: the property's next value
 * (`null` clears it), or `'unchanged'` when the card is already there. */
export type LaneMove = { value: unknown } | 'unchanged'

/**
 * The value a tap-to-move writes, the phone's twin of the board's drop. A
 * single-valued property takes the lane's value. A multi-select card can sit
 * in several lanes at once, so the move drops the lane it was opened from and
 * gains the target's, keeping every other option it carries; the "No <name>"
 * lane only drops the source option.
 */
export function laneMove(
  property: TagProperty,
  entry: CollectionEntry,
  from: BoardColumn,
  to: BoardColumn,
): LaneMove {
  if (from.label === to.label) {
    return 'unchanged'
  }
  if (property.type !== 'multiselect') {
    if (to.entries.some((candidate) => candidate.path === entry.path)) {
      return 'unchanged'
    }
    return { value: to.commit }
  }
  const target = typeof to.commit === 'string' ? to.commit : null
  const next = editorSeedList(entry.properties[property.key]).filter(
    (option) => option !== from.label && option !== target,
  )
  if (target !== null) {
    next.push(target)
  }
  return { value: next.length > 0 ? next : null }
}
