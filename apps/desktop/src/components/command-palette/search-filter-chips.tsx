import type { ReactElement } from 'react'
import type { SearchFilterChip } from '@reflect/core'
import { Badge } from '@/components/ui/badge'

export interface SearchFilterChipsProps {
  /** The filters the query parsed into (`describeSearchFilters`). */
  chips: readonly SearchFilterChip[]
}

/**
 * The palette's read-back of the search operators it understood: one chip per
 * filter, exclusions marked with a minus. A token that shows no chip stayed
 * plain search text, so a typo in `path:` or `[status:…]` is visible at once.
 */
export function SearchFilterChips({ chips }: SearchFilterChipsProps): ReactElement | null {
  if (chips.length === 0) {
    return null
  }
  return (
    <div
      aria-label="Active search filters"
      className="flex flex-wrap gap-1.5 border-b border-border px-3.5 py-2"
    >
      {chips.map((chip, index) => (
        <Badge
          key={`${chip.negated ? '-' : '+'}${chip.label}:${index}`}
          variant={chip.negated ? 'destructive' : 'secondary'}
          className="max-w-64 truncate font-normal"
        >
          {chip.negated ? `−${chip.label}` : chip.label}
        </Badge>
      ))}
    </div>
  )
}
