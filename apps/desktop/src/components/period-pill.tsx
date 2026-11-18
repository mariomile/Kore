import type { ReactElement } from 'react'
import { ChevronLeft, ChevronRight } from '@/components/icons'
import { cn } from '@/lib/utils'

interface PeriodPillProps {
  /** The period being read (`Nov 17`, `This week`). */
  label: string
  /** What the label does: jump back to the current period. */
  labelTitle: string
  /** The current period is already open: the label rests, muted. */
  labelDisabled?: boolean
  onLabel: () => void
  /** Accessible names of the chevrons (`Previous day`, `Next week`). */
  previousLabel: string
  nextLabel: string
  onPrevious: () => void
  onNext: () => void
  className?: string
}

/**
 * Craft's ‹ period › pill (Plan 28 slice 3): chevrons hop to the adjacent
 * period and the label jumps back to the current one. Shared by the daily
 * stream's floating date pill and the weekly note's header, so a day and a
 * week page step the same way.
 */
export function PeriodPill({
  label,
  labelTitle,
  labelDisabled = false,
  onLabel,
  previousLabel,
  nextLabel,
  onPrevious,
  onNext,
  className,
}: PeriodPillProps): ReactElement {
  return (
    <div
      className={cn(
        'pointer-events-auto flex items-center rounded-full border border-border bg-surface p-0.5 shadow-sm',
        className,
      )}
    >
      <button
        type="button"
        aria-label={previousLabel}
        title={previousLabel}
        onClick={onPrevious}
        className="app-icon-button text-text-muted hover:text-text"
      >
        <ChevronLeft aria-hidden className="size-3.5" />
      </button>
      <button
        type="button"
        title={labelDisabled ? undefined : labelTitle}
        disabled={labelDisabled}
        onClick={onLabel}
        className="rounded-full px-1.5 text-xs font-medium text-text-secondary transition-colors duration-150 ease-swift hover:text-text disabled:text-text-muted disabled:hover:text-text-muted"
      >
        {label}
      </button>
      <button
        type="button"
        aria-label={nextLabel}
        title={nextLabel}
        onClick={onNext}
        className="app-icon-button text-text-muted hover:text-text"
      >
        <ChevronRight aria-hidden className="size-3.5" />
      </button>
    </div>
  )
}
