import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react'

/**
 * Divider between two panes. Drag sets the left pane's flex-basis in pixels
 * for this session only; widths reset on relaunch by design.
 */
export function PaneResizeHandle(): ReactElement {
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const handle = event.currentTarget
    // The handle resizes its previous sibling, the pane to its left.
    const left = handle.previousElementSibling
    if (!(left instanceof HTMLElement)) {
      return
    }
    const startX = event.clientX
    const startWidth = left.getBoundingClientRect().width
    try {
      handle.setPointerCapture(event.pointerId)
    } catch {
      // A synthetic pointerdown (tests) names no live pointer to capture.
    }
    const onMove = (move: PointerEvent): void => {
      left.style.flex = `0 0 ${Math.max(360, startWidth + move.clientX - startX)}px`
    }
    // Every way the drag can end tears the same listeners down: a pointerup,
    // a gesture the OS claims (pointercancel), or capture lost some other
    // way. Missing one leaves a live pointermove that keeps resizing the
    // column from a stale start on the next hover.
    const stop = (): void => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', stop)
      handle.removeEventListener('pointercancel', stop)
      handle.removeEventListener('lostpointercapture', stop)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', stop)
    handle.addEventListener('pointercancel', stop)
    handle.addEventListener('lostpointercapture', stop)
  }
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize pane"
      onPointerDown={onPointerDown}
      className="relative w-2 shrink-0 cursor-col-resize touch-none after:absolute after:inset-y-0 after:w-0.5 after:bg-border-strong after:opacity-0 hover:after:opacity-60"
    />
  )
}
