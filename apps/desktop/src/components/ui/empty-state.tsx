import type { ComponentType, ReactElement, ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  title: string
  /** What will show here, or how to make it show, in plain words. */
  description?: ReactNode
  /** The one next step, when there is one: a button. */
  action?: ReactNode
  /** `status` for a live region (a list that just emptied), else none. */
  role?: 'status'
  className?: string
}

/**
 * What a page or a list shows when it has nothing yet: a glyph in a soft
 * tile, a title, one sentence and at most one action. Shared so an empty
 * page reads as designed instead of as a stray line of grey text.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  role,
  className,
}: EmptyStateProps): ReactElement {
  return (
    <div role={role} className={cn('flex flex-col items-center px-6 py-16 text-center', className)}>
      <span className="flex size-11 items-center justify-center rounded-2xl bg-surface-hover text-text-muted">
        <Icon aria-hidden className="size-5" />
      </span>
      <p className="mt-4 text-sm font-semibold text-text">{title}</p>
      {description === undefined ? null : (
        <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-text-muted">{description}</p>
      )}
      {action === undefined ? null : <div className="mt-4">{action}</div>}
    </div>
  )
}
