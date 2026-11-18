import { useLayoutEffect, type RefObject } from 'react'

/**
 * Keeps one visual thumb aligned with the active item in a tab or segmented
 * control. Items opt in with `data-sliding-value`; CSS owns the animation so
 * Reduce Motion can disable it without branching in JavaScript.
 *
 * The first placement skips that animation: the thumb starts hidden at the
 * container's corner with no size, so transitioning into place would fade it
 * in while it grows out of the top-left (visible on every launch, under the
 * Daily tab). Only later moves between items slide.
 */
export function useSlidingIndicator<Container extends HTMLElement, Indicator extends HTMLElement>(
  containerRef: RefObject<Container | null>,
  indicatorRef: RefObject<Indicator | null>,
  activeValue: string,
): void {
  useLayoutEffect(() => {
    const container = containerRef.current
    const indicator = indicatorRef.current
    if (container === null || indicator === null) {
      return
    }

    let placed = indicator.style.opacity === '1'

    const positionIndicator = (): void => {
      const activeItem = [...container.querySelectorAll<HTMLElement>('[data-sliding-value]')].find(
        (item) => item.dataset.slidingValue === activeValue,
      )
      if (activeItem === undefined) {
        return
      }

      const containerBounds = container.getBoundingClientRect()
      const itemBounds = activeItem.getBoundingClientRect()
      if (!placed) {
        indicator.style.transition = 'none'
      }
      indicator.style.width = `${itemBounds.width}px`
      indicator.style.height = `${itemBounds.height}px`
      indicator.style.transform = `translate3d(${itemBounds.left - containerBounds.left}px, ${itemBounds.top - containerBounds.top}px, 0)`
      indicator.style.opacity = '1'
      if (!placed) {
        placed = true
        // Commit the jump with transitions off, then hand animation back to
        // the stylesheet for every later move.
        indicator.getBoundingClientRect()
        indicator.style.removeProperty('transition')
      }
    }

    positionIndicator()
    const observer = new ResizeObserver(positionIndicator)
    observer.observe(container)
    return () => observer.disconnect()
  }, [activeValue, containerRef, indicatorRef])
}
