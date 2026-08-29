import { useLayoutEffect, type RefObject } from 'react'

/**
 * Keeps one visual thumb aligned with the active item in a tab or segmented
 * control. Items opt in with `data-sliding-value`; CSS owns the animation so
 * Reduce Motion can disable it without branching in JavaScript.
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

    const positionIndicator = (): void => {
      const activeItem = [...container.querySelectorAll<HTMLElement>('[data-sliding-value]')].find(
        (item) => item.dataset.slidingValue === activeValue,
      )
      if (activeItem === undefined) {
        return
      }

      const containerBounds = container.getBoundingClientRect()
      const itemBounds = activeItem.getBoundingClientRect()
      indicator.style.width = `${itemBounds.width}px`
      indicator.style.height = `${itemBounds.height}px`
      indicator.style.transform = `translate3d(${itemBounds.left - containerBounds.left}px, ${itemBounds.top - containerBounds.top}px, 0)`
      indicator.style.opacity = '1'
    }

    positionIndicator()
    const observer = new ResizeObserver(positionIndicator)
    observer.observe(container)
    return () => observer.disconnect()
  }, [activeValue, containerRef, indicatorRef])
}
