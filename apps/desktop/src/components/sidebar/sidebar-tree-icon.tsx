import type { ReactElement, ReactNode } from 'react'
import { ChevronDown, ChevronRight } from '@/components/icons'
import { cn } from '@/lib/utils'

interface SidebarTreeIconProps {
  icon: ReactNode
  open: boolean
  /** Present when the slot is its own expand button (the row itself opens a page). */
  toggle?: { label: string; onToggle: () => void } | undefined
}

/**
 * An expandable row's icon, Notion-style: the glyph sits in the shared icon
 * column and turns into the disclosure chevron while the row is hovered or
 * the button (its own toggle, or the whole row when the row toggles) has
 * keyboard focus, so a tree needs no extra chevron column and
 * its icons stay level with the flat rows above. Pure CSS swap: no state.
 */
export function SidebarTreeIcon({ icon, open, toggle }: SidebarTreeIconProps): ReactElement {
  const Chevron = open ? ChevronDown : ChevronRight
  const swap = 'col-start-1 row-start-1 flex items-center justify-center'
  const glyphs = (
    <>
      <span
        aria-hidden
        className={cn(
          swap,
          'group-hover/tree-row:invisible',
          toggle
            ? 'group-focus-visible/toggle:invisible'
            : 'group-focus-visible/tree-row:invisible',
        )}
      >
        {icon}
      </span>
      <span
        aria-hidden
        className={cn(
          swap,
          'invisible text-text-muted group-hover/tree-row:visible',
          toggle
            ? 'group-focus-visible/toggle:visible group-hover/toggle:text-text'
            : 'group-focus-visible/tree-row:visible',
        )}
      >
        <Chevron className="size-3" />
      </span>
    </>
  )
  const slotClass = 'grid size-4.5 flex-none rounded-sm'
  if (toggle === undefined) {
    return <span className={slotClass}>{glyphs}</span>
  }
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={toggle.label}
      onClick={toggle.onToggle}
      className={cn(slotClass, 'group/toggle')}
    >
      {glyphs}
    </button>
  )
}
