import { useCallback, useSyncExternalStore, type ReactElement } from 'react'
import { cn } from '@/lib/utils'

/** Scrolled past this, the veil is on; within it, the surface is at rest. */
const VEIL_THRESHOLD_PX = 8

interface ScrollVeilProps {
  /**
   * The scroll container whose top edge this veil dissolves. The veil listens
   * to it directly (passive), so surfaces don't thread scroll state through;
   * `null` (the element not yet attached) renders the veil dormant.
   */
  scrollElement: HTMLElement | null
  /**
   * Placement on top of the stock `absolute` box — each surface sizes its own
   * dissolve zone (e.g. `inset-x-0 top-0 h-12`) against a positioned wrapper
   * that shares the scroll container's top edge.
   */
  className?: string
}

/**
 * The dissolve zone a scroll surface paints at its top edge (Plan 28,
 * Craft's register): scrolled content doesn't hard-clip at the container
 * boundary, it melts into the pane surface through a color fade over two
 * progressively-masked backdrop-blur bands. The veil only exists while the
 * container is actually scrolled — at rest it is transparent, so content
 * resting inside the zone (a grid's first row, a note's title) stays crisp
 * and nothing blurs a surface that isn't moving under it. Pure paint
 * otherwise: `pointer-events: none`, `aria-hidden`, and scrolling re-renders
 * only on the on/off flip (the scroll position is an external store; the
 * snapshot is the boolean).
 */
export function ScrollVeil({ scrollElement, className }: ScrollVeilProps): ReactElement {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (scrollElement === null) {
        return () => {}
      }
      scrollElement.addEventListener('scroll', onStoreChange, { passive: true })
      return () => {
        scrollElement.removeEventListener('scroll', onStoreChange)
      }
    },
    [scrollElement],
  )
  const veiled = useSyncExternalStore(
    subscribe,
    () => scrollElement !== null && scrollElement.scrollTop > VEIL_THRESHOLD_PX,
  )

  return (
    <div
      aria-hidden
      data-veiled={veiled ? 'true' : undefined}
      className={cn('app-scroll-veil', className)}
    >
      <div className="app-scroll-veil-soft" />
      <div className="app-scroll-veil-deep" />
    </div>
  )
}
