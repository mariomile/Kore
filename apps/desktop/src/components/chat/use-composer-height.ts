import { useLayoutEffect, useRef, type RefObject } from 'react'

/**
 * Publishes the floating composer's measured height as
 * `--chat-composer-height` on the document root — the same pattern the
 * mobile tab bar uses for `--mobile-tab-bar-height` — so the turn list can
 * pad its bottom edge past the overlay card and the scroll-to-end button
 * can sit above it. Content-sized: the height moves with attachments, a
 * growing draft, and queued-message cards. The variable clears on unmount,
 * leaving consumers their own fallback.
 */
export function useComposerHeightVar(): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    const node = ref.current
    const root = document.documentElement
    if (node === null) {
      return
    }
    const publish = (): void => {
      root.style.setProperty('--chat-composer-height', `${node.offsetHeight}px`)
    }
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(node)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--chat-composer-height')
    }
  }, [])

  return ref
}
