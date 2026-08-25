import { useLayoutEffect, useRef, type RefObject } from 'react'

interface BarHeightVar {
  /** The element the CSS variable is set on (the screen root). */
  scopeRef: RefObject<HTMLDivElement | null>
  /** The measured bar (the screen's overlay header). */
  barRef: RefObject<HTMLElement | null>
}

/**
 * Publishes an overlay bar's measured height as a CSS variable on a scope
 * element, so the scroller beneath can pad past it — the same pattern the
 * tab bar uses for `--mobile-tab-bar-height`, but scoped to the screen
 * instead of the document root: stacked cards each keep their own header
 * height (a pushed note over the daily surface must not clobber it).
 * Content-sized — the height moves with rotation (safe-area padding) and
 * with headers whose second row comes and goes (search filters).
 */
export function useBarHeightVar(variable: string): BarHeightVar {
  const scopeRef = useRef<HTMLDivElement | null>(null)
  const barRef = useRef<HTMLElement | null>(null)

  useLayoutEffect(() => {
    const scope = scopeRef.current
    const bar = barRef.current
    if (scope === null || bar === null) {
      return
    }
    const publish = (): void => {
      scope.style.setProperty(variable, `${bar.offsetHeight}px`)
    }
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(bar)
    return () => {
      observer.disconnect()
      scope.style.removeProperty(variable)
    }
  }, [variable])

  return { scopeRef, barRef }
}
