import { useCallback, useEffect, useRef, type ReactElement, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useRouter } from './router'

interface ScrollRestoredProps {
  className?: string
  children: ReactNode
  /**
   * Hands the scroll element itself to the caller (a stable setter) — the
   * ScrollVeil hookup, which needs the element to listen to, not a ref that
   * may still be null when its effect runs.
   */
  elementRef?: (element: HTMLDivElement | null) => void
}

/**
 * A scroll container wired to the router's per-entry scroll memory (Plan 06b):
 * it reports its offset as the user scrolls and restores the saved offset when
 * a history entry is revisited via back/forward. The daily stream does the same
 * through its virtualizer; this is for plain views (note, search).
 *
 * The container is positioned (`relative`) so absolutely-positioned
 * descendants — `sr-only` controls especially — resolve against it and scroll
 * with the content. Without it they escape to the workspace column at their
 * static offsets, overflowing the frame into a second scrollbar.
 */
export function ScrollRestored({
  className,
  children,
  elementRef,
}: ScrollRestoredProps): ReactElement {
  const { entryId, saveScrollState, savedScroll } = useRouter()
  const ref = useRef<HTMLDivElement | null>(null)

  // Re-run whenever the history entry changes (back/forward, or note→note in
  // the same mounted container): restore the entry's offset, or reset to the
  // top for an entry that has none — never carry the previous view's position.
  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = savedScroll() ?? 0
    }
  }, [entryId, savedScroll])

  // Memoized so the callback keeps its identity across renders — an inline
  // arrow would make React detach/re-attach it (null, then the element) on
  // every commit, driving the caller's setter needlessly.
  const mergedRef = useCallback(
    (element: HTMLDivElement | null) => {
      ref.current = element
      elementRef?.(element)
    },
    [elementRef],
  )

  return (
    <div
      ref={mergedRef}
      className={cn(className, 'relative')}
      onScroll={(event) => saveScrollState(event.currentTarget.scrollTop)}
    >
      {children}
    </div>
  )
}
