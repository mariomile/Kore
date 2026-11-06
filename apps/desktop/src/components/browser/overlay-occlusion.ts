/**
 * The embedded browser is a native child webview, so it always draws above
 * the main webview's DOM: a menu, popover or dialog that overlaps the browser
 * host is painted *under* the page and can't be seen or clicked. The pane
 * watches for such overlays and hides the page while one covers it.
 */

/** Floating surfaces that must stay visible above the page. */
const OVERLAY_SELECTOR = '[role="menu"],[role="listbox"],[role="dialog"],[role="alertdialog"]'

/**
 * Toasts are `role="dialog"` too, but hiding the page for a toast's whole
 * lifetime would make it blink out after every clip; they are skipped.
 */
const IGNORED_OVERLAY_SELECTOR = '[data-slot^="toast"]'

interface RectLike {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

/** Strict overlap of two rectangles; touching edges and empty rects don't count. */
export function rectsOverlap(a: RectLike, b: RectLike): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

/** Whether an open overlay anywhere in `root` overlaps `host`. */
export function isHostCovered(host: Element, root: ParentNode = document): boolean {
  const hostRect = host.getBoundingClientRect()
  if (hostRect.width <= 0 || hostRect.height <= 0) {
    return false
  }
  for (const overlay of root.querySelectorAll(OVERLAY_SELECTOR)) {
    if (host.contains(overlay) || overlay.closest(IGNORED_OVERLAY_SELECTOR) !== null) {
      continue
    }
    const rect = overlay.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0 && rectsOverlap(rect, hostRect)) {
      return true
    }
  }
  return false
}

/**
 * Call `onChange(covered)` whenever an overlay starts or stops covering
 * `host`. Overlays mount anywhere (portals on `body`, the command palette in
 * the app tree) and settle their position after mounting, so the check runs
 * at most once per frame after any DOM insertion, removal, or style change.
 * Starts uncovered; returns the unsubscribe.
 */
export function watchOverlayOcclusion(
  host: Element,
  onChange: (covered: boolean) => void,
): () => void {
  let covered = false
  let frame: number | null = null
  const evaluate = (): void => {
    frame = null
    const next = isHostCovered(host)
    if (next !== covered) {
      covered = next
      onChange(next)
    }
  }
  const schedule = (): void => {
    frame ??= requestAnimationFrame(evaluate)
  }
  const observer = new MutationObserver(schedule)
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'hidden'],
  })
  window.addEventListener('resize', schedule)
  schedule()
  return () => {
    observer.disconnect()
    window.removeEventListener('resize', schedule)
    if (frame !== null) {
      cancelAnimationFrame(frame)
    }
  }
}
