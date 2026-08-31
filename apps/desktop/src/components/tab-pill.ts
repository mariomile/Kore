import { useEffect, useRef, type RefObject } from 'react'
import { cn } from '@/lib/utils'

/**
 * The app's tab shape, in one place. Both tab rows on the window's top band
 * are built from it — the content column's workspace strip and the context
 * rail's panel switcher — so the two can never drift into different tabs.
 *
 * A tab is a compact pill; the selected one is raised onto its own surface,
 * the rest stay quiet until hovered. It gives up width down to
 * {@link TAB_PILL_MIN_WIDTH} and no further: past that the row scrolls, since
 * a strip of two-letter stumps names nothing. Tabs that carry no label (the
 * strip's pinned tabs, which collapse to their icon) drop the floor.
 */
export function tabPillClass(active: boolean): string {
  return cn(
    'flex h-7 max-w-[12rem] shrink items-center gap-1.5 rounded-lg px-3 text-xs font-medium',
    TAB_PILL_MIN_WIDTH,
    'transition-all duration-150 ease-swift active:scale-[0.97]',
    active
      ? 'border border-border bg-surface text-text shadow-sm'
      : 'text-text-secondary hover:bg-surface-hover hover:text-text',
  )
}

/**
 * How narrow a labelled tab may get — wide enough to keep a readable stretch
 * of its title after the padding and the close button.
 */
const TAB_PILL_MIN_WIDTH = 'min-w-32'

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

/**
 * Keep the selected tab inside its scrollport. Now that a crowded row scrolls
 * rather than squeezing every pill to a stump, the tab you just activated (or
 * the one a keyboard cycle landed on) can sit off-screen — this brings it back
 * with the least scrolling that does it, leaving every other scroller alone.
 */
export function useTabScrollIntoView<TabElement extends HTMLElement = HTMLElement>(
  active: boolean,
): RefObject<TabElement | null> {
  const ref = useRef<TabElement | null>(null)
  useEffect(() => {
    if (active) {
      ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }, [active])
  return ref
}
