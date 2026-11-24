import type { ReactElement, ReactNode } from 'react'
import { ChevronDown, ChevronRight } from '@/components/icons'
import { cn } from '@/lib/utils'

/**
 * The left-rail column every sidebar row shares, in px from the row's own
 * left edge: the row inset before the 18px icon slot (the nav rows' `px-2.5`),
 * the step a nested level adds, and where a label starts (slot + 12px gap).
 * Section headers, icons and labels line up on these, so the Tags and
 * Folders titles sit flush with the rows beneath them.
 */
export const SIDEBAR_ROW_INSET_PX = 10
export const SIDEBAR_INDENT_PX = 12
export const SIDEBAR_LABEL_OFFSET_PX = 30

/** Left padding for a tree row at `depth`; icon-less rows start at the label line. */
export function sidebarTreePadding(depth: number, iconless = false): number {
  return SIDEBAR_ROW_INSET_PX + depth * SIDEBAR_INDENT_PX + (iconless ? SIDEBAR_LABEL_OFFSET_PX : 0)
}

/** A clickable tree row's layout: icon, 12px gap, label, trailing count. */
export const SIDEBAR_TREE_ITEM_CLASS =
  'flex w-full items-center gap-3 rounded-md py-1 pr-2.5 text-left leading-5 transition-colors duration-[50ms]'

/** Hover group a tree row declares so its icon can turn into a chevron. */
export const SIDEBAR_TREE_ROW_CLASS = 'group/tree-row'

interface SidebarTreeIconProps {
  icon: ReactNode
  open: boolean
  /** Present when the slot is its own expand button (the row itself opens a page). */
  toggle?: { label: string; onToggle: () => void } | undefined
}

/**
 * An expandable row's icon, Notion-style: the glyph sits in the shared icon
 * column and turns into the disclosure chevron while the row is hovered or
 * the button has keyboard focus, so a tree needs no extra chevron column and
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
          toggle && 'group-focus-visible/toggle:invisible',
        )}
      >
        {icon}
      </span>
      <span
        aria-hidden
        className={cn(
          swap,
          'invisible text-text-muted group-hover/tree-row:visible',
          toggle && 'group-focus-visible/toggle:visible group-hover/toggle:text-text',
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
