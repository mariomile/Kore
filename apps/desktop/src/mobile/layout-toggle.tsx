import { useRef, type ReactElement } from 'react'
import { LayoutGrid, List } from '@/components/icons'
import { useSlidingIndicator } from '@/mobile/use-sliding-indicator'

/** The notes lists' two layouts on iPhone (the same `allNotesView` setting as desktop). */
export type NotesLayout = 'list' | 'grid'

interface LayoutToggleProps {
  view: NotesLayout
  onChange: (view: NotesLayout) => void
}

/**
 * Compact list/grid switch for the Notes tab and folder pages, the same
 * labels as desktop so the setting is one.
 */
export function LayoutToggle({ view, onChange }: LayoutToggleProps): ReactElement {
  const controlRef = useRef<HTMLDivElement | null>(null)
  const indicatorRef = useRef<HTMLSpanElement | null>(null)

  useSlidingIndicator(controlRef, indicatorRef, view)

  return (
    <div
      ref={controlRef}
      role="group"
      aria-label="Layout"
      className="relative flex shrink-0 items-center gap-0.5 rounded-full bg-surface-hover p-0.5"
    >
      <span
        ref={indicatorRef}
        data-sliding-indicator
        aria-hidden
        className="pointer-events-none absolute top-0 left-0 z-10 rounded-full bg-surface opacity-0 shadow-sm transition-[transform,width,height,opacity] duration-200 ease-swift motion-reduce:transition-none"
      />
      <button
        type="button"
        data-sliding-value="list"
        aria-label="List view"
        aria-pressed={view === 'list'}
        onClick={() => onChange('list')}
        className={`relative z-20 flex size-11 items-center justify-center rounded-full transition-colors duration-150 motion-reduce:transition-none ${
          view === 'list' ? 'text-text' : 'text-text-muted hover:text-text-secondary'
        }`}
      >
        <List aria-hidden className="size-4" />
      </button>
      <button
        type="button"
        data-sliding-value="grid"
        aria-label="Grid view"
        aria-pressed={view === 'grid'}
        onClick={() => onChange('grid')}
        className={`relative z-20 flex size-11 items-center justify-center rounded-full transition-colors duration-150 motion-reduce:transition-none ${
          view === 'grid' ? 'text-text' : 'text-text-muted hover:text-text-secondary'
        }`}
      >
        <LayoutGrid aria-hidden className="size-4" />
      </button>
    </div>
  )
}
