import { cn } from '@/lib/utils'

/**
 * The app's tab shape, in one place. Both tab rows on the window's top band
 * are built from it — the content column's workspace strip and the context
 * rail's panel switcher — so the two can never drift into different tabs.
 *
 * A tab is a compact pill that gives up width (and truncates) before its row
 * overflows; the selected one is raised onto its own surface, the rest stay
 * quiet until hovered.
 */
export function tabPillClass(active: boolean): string {
  return cn(
    'flex h-7 min-w-0 max-w-[12rem] shrink items-center gap-1.5 rounded-lg px-3 text-xs font-medium',
    'transition-all duration-150 ease-swift active:scale-[0.97]',
    active
      ? 'border border-border bg-surface text-text shadow-sm'
      : 'text-text-secondary hover:bg-surface-hover hover:text-text',
  )
}

/**
 * The close affordance inside a tab. It is noise on every tab at once, so it
 * belongs to the tab under the pointer or the one already selected.
 */
export function tabCloseClass(active: boolean): string {
  return cn(
    'flex size-4 shrink-0 items-center justify-center rounded text-text-muted',
    'transition-[color,background-color,opacity] duration-150 ease-swift hover:bg-surface-active hover:text-text',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
    active ? '' : 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100',
  )
}
