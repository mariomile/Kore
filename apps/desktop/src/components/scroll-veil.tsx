import { memo, useCallback, useSyncExternalStore, type ReactElement } from 'react'
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
   * Sizing on top of the stock box (`absolute`, pinned to the wrapper's top
   * edge, `h-12` deep). Surfaces only override to size a deliberate
   * exception.
   */
  className?: string
}

/**
 * The dissolve zone a scroll surface paints at its top edge (Plan 28,
 * Craft's register): scrolled content doesn't hard-clip at the container
 * boundary, it melts into the pane surface through a color fade over two
 * progressively-masked backdrop-blur bands (all painted by the one element's
 * background and pseudos — see `.app-scroll-veil`). The veil only exists
 * while the container is actually scrolled — at rest it is hidden outright,
 * so resting content stays crisp and the blur layers cost nothing on
 * surfaces that never scroll. Scrolling re-renders nothing but the on/off
 * flip: the scroll position is an external store and the snapshot is the
 * boolean.
 */
export const ScrollVeil = memo(function ScrollVeil({
  scrollElement,
  className,
}: ScrollVeilProps): ReactElement {
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
  const getSnapshot = useCallback(
    () => (scrollElement?.scrollTop ?? 0) > VEIL_THRESHOLD_PX,
    [scrollElement],
  )
  const veiled = useSyncExternalStore(subscribe, getSnapshot)

  return (
    <div
      aria-hidden
      data-veiled={veiled ? 'true' : undefined}
      className={cn('app-scroll-veil h-12', className)}
    />
  )
})
