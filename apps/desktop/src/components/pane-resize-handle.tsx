import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react'

interface PaneResizeHandleProps {
  /** `columns` divides two columns side by side, `rows` two panes stacked. */
  axis: 'columns' | 'rows'
}

/**
 * Divider between two panes. Drag sets the previous sibling's flex-basis in
 * pixels for this session only; sizes reset on relaunch by design.
 */
export function PaneResizeHandle({ axis }: PaneResizeHandleProps): ReactElement {
  const rows = axis === 'rows'
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const handle = event.currentTarget
    // The handle resizes its previous sibling: the pane to its left on the
    // column axis, the pane above it on the row axis.
    const before = handle.previousElementSibling
    if (!(before instanceof HTMLElement)) {
      return
    }
    const start = rows ? event.clientY : event.clientX
    const box = before.getBoundingClientRect()
    const startSize = rows ? box.height : box.width
    const minimum = rows ? 200 : 360
    try {
      handle.setPointerCapture(event.pointerId)
    } catch {
      // A synthetic pointerdown (tests) names no live pointer to capture.
    }
    const onMove = (move: PointerEvent): void => {
      const moved = (rows ? move.clientY : move.clientX) - start
      before.style.flex = `0 0 ${Math.max(minimum, startSize + moved)}px`
    }
    // Every way the drag can end tears the same listeners down: a pointerup,
    // a gesture the OS claims (pointercancel), or capture lost some other
    // way. Missing one leaves a live pointermove that keeps resizing the
    // pane from a stale start on the next hover.
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
      aria-orientation={rows ? 'horizontal' : 'vertical'}
      aria-label="Resize pane"
      onPointerDown={onPointerDown}
      className={
        rows
          ? 'relative h-2 shrink-0 cursor-row-resize touch-none after:absolute after:inset-x-0 after:h-0.5 after:bg-border-strong after:opacity-0 hover:after:opacity-60'
          : 'relative w-2 shrink-0 cursor-col-resize touch-none after:absolute after:inset-y-0 after:w-0.5 after:bg-border-strong after:opacity-0 hover:after:opacity-60'
      }
    />
  )
}
