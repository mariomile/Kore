import type { ReactElement } from 'react'
import { selectOptionBadgeClass } from '@/components/tags/select-colors'
import { cn } from '@/lib/utils'

interface TagChipsProps {
  tags: readonly string[]
  /** How many chips show before the rest fold into a `+N` count. */
  max?: number
  className?: string
}

/**
 * A note's tags as small colored pills, for a table cell or a card footer. A
 * tag hashes into the same palette select options use, so `type/project` is
 * the same hue on every row and every device with nothing to configure. The
 * pill shows the tag's last segment (`project`); the title carries the whole
 * tag and the ones folded into `+N`.
 */
export function TagChips({ tags, max = 2, className }: TagChipsProps): ReactElement {
  const shown = tags.slice(0, max)
  const folded = tags.length - shown.length
  return (
    <span
      title={tags.length === 0 ? undefined : tags.map((tag) => `#${tag}`).join(' ')}
      className={cn('flex min-w-0 items-center gap-1', className)}
    >
      {shown.map((tag) => (
        <span
          key={tag}
          className={cn(
            'min-w-0 truncate rounded-full px-2 py-0.5 text-xs leading-4 font-medium',
            selectOptionBadgeClass(tag),
          )}
        >
          {tag.slice(tag.lastIndexOf('/') + 1)}
        </span>
      ))}
      {folded > 0 ? (
        <span className="shrink-0 text-xs tabular-nums text-text-muted">+{folded}</span>
      ) : null}
    </span>
  )
}
