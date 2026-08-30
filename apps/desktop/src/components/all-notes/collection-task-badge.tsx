import type { ReactElement } from 'react'
import { CheckCircle } from '@/components/icons'

/**
 * The row's open-task count — the portfolio pulse on a project collection.
 * Rendered only when the count is positive: a zero would be furniture on
 * collections that never carry tasks (books, people).
 */
export function CollectionTaskBadge({ count }: { count: number }): ReactElement {
  return (
    <span
      title={`${count} open ${count === 1 ? 'task' : 'tasks'}`}
      className="flex shrink-0 items-center gap-0.5 rounded-full bg-surface-hover px-1.5 py-px text-2xs font-medium tabular-nums text-text-muted"
    >
      <CheckCircle aria-hidden className="size-3" />
      {count}
    </span>
  )
}
