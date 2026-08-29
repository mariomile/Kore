import type { ReactElement } from 'react'
import { cn } from '@/lib/utils'

interface TaskBreadcrumbsProps {
  /** The context's display labels ({@link TaskContext.visibleBreadcrumbs}); empty renders nothing. */
  breadcrumbs: readonly string[]
  /** Select every task row sharing this outline context; omit on read-only surfaces. */
  onSelect?: () => void
  /** Additional classes applied to the wrapper element. */
  className?: string
}

/**
 * One V1-style outline-context row above the consecutive tasks it labels.
 *
 * Renders a `div`, not an `li`: the desktop Tasks screen flattens headers,
 * breadcrumbs and task rows into one virtualized sequence that is not a list,
 * and the mobile tab supplies its own `li` around this.
 */
export function TaskBreadcrumbs({
  breadcrumbs,
  onSelect,
  className,
}: TaskBreadcrumbsProps): ReactElement | null {
  if (breadcrumbs.length === 0) {
    return null
  }
  const label = breadcrumbs.join(' → ')

  return (
    <div className={cn('min-w-0 px-4 pt-1.5 lg:px-12', className)}>
      {onSelect === undefined ? (
        <span
          title={label}
          className="block max-w-full truncate text-left text-xs leading-5 text-text-muted"
        >
          {label}
        </span>
      ) : (
        <button
          type="button"
          title={label}
          onClick={onSelect}
          className="block max-w-full truncate text-left text-xs leading-5 text-text-muted transition-colors hover:text-text focus-visible:text-text focus-visible:outline-none"
        >
          {label}
        </button>
      )}
    </div>
  )
}
