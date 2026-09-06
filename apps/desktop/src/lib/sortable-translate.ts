import type { CSSProperties } from 'react'
import { CSS, type Transform } from '@dnd-kit/utilities'

/**
 * Translation-only style for a dnd-kit sortable item.
 *
 * `CSS.Transform.toString` also applies scaleX/scaleY so the dragged item
 * morphs toward the drop target's size. Mixed-height lists (sidebar shelves,
 * pinned rows, tab pills) then enlarge titles over their neighbors.
 */
export function sortableTranslateStyle(
  transform: Transform | null,
  transition: string | undefined,
): CSSProperties {
  return {
    transform: CSS.Translate.toString(transform),
    transition,
  }
}
