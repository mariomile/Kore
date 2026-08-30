import { useLayoutEffect, useState } from 'react'

/**
 * Whether a clamped box is taller than its content allows, so a bottom fade
 * is applied only when the clip is real. Observed rather than computed once —
 * image loads and font swaps change the content height after mount. The
 * element lives in state (not a ref) so the observer attaches on mount and
 * re-attaches if the node is replaced. Shared by the wiki-link hover card and
 * the note-grid card previews (Plan 28).
 */
export function useOverflowing(): {
  setRoot: (root: HTMLDivElement | null) => void
  overflowing: boolean
} {
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const [overflowing, setOverflowing] = useState(false)

  useLayoutEffect(() => {
    if (root === null || typeof ResizeObserver === 'undefined') {
      return
    }
    const update = (): void => {
      setOverflowing(root.scrollHeight > root.clientHeight + 1)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(root)
    for (const child of root.children) {
      observer.observe(child)
    }
    return () => observer.disconnect()
  }, [root])

  return { setRoot, overflowing }
}
