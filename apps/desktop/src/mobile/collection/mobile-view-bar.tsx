import type { ReactElement } from 'react'
import { ChevronDown, Sliders, type Icon } from '@/components/icons'
import { cn } from '@/lib/utils'

interface MobileViewBarProps {
  /** The active view's name, on the pill that opens the views sheet. */
  viewName: string
  glyph: Icon
  /** How many filters narrow the rows (shown beside the options icon). */
  filterCount: number
  /** The view narrows, orders or groups its rows: the options button lights up. */
  lensActive: boolean
  onChooseView: () => void
  onAdjustView: () => void
}

/**
 * A collection's view row on the phone: the view pill (the views sheet) at
 * the left, the view options at the right. Shared by a type's page and a
 * base, so a database reads the same wherever it lives.
 */
export function MobileViewBar({
  viewName,
  glyph: Glyph,
  filterCount,
  lensActive,
  onChooseView,
  onAdjustView,
}: MobileViewBarProps): ReactElement {
  return (
    <div className="flex items-center gap-2 pt-2">
      <button
        type="button"
        onClick={onChooseView}
        aria-label={`View: ${viewName}`}
        aria-haspopup="dialog"
        className="relative flex h-9 min-w-0 items-center gap-1.5 rounded-full bg-surface-hover pr-2.5 pl-3 text-[14px] font-medium text-text before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] active:bg-surface-active"
      >
        <Glyph aria-hidden className="size-4 shrink-0 text-text-muted" />
        <span className="truncate">{viewName}</span>
        <ChevronDown aria-hidden className="size-3.5 shrink-0 text-text-muted" />
      </button>
      <div className="flex-1" />
      <button
        type="button"
        onClick={onAdjustView}
        aria-label={
          filterCount > 0
            ? `View options, ${filterCount} ${filterCount === 1 ? 'filter' : 'filters'}`
            : 'View options'
        }
        aria-haspopup="dialog"
        className={cn(
          "relative flex h-9 shrink-0 items-center gap-1 rounded-full before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] transition-colors",
          filterCount > 0 ? 'pr-3 pl-2.5' : 'w-9 justify-center',
          lensActive
            ? 'bg-accent-soft text-accent-soft-text'
            : 'bg-surface-hover text-text-muted active:bg-surface-active',
        )}
      >
        <Sliders aria-hidden className="size-[18px]" />
        {filterCount > 0 ? (
          <span className="text-[13px] font-semibold tabular-nums">{filterCount}</span>
        ) : null}
      </button>
    </div>
  )
}
