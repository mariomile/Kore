import type { ReactElement } from 'react'
import type { CanvasRect } from '@kore/core'

/** The handle's diameter on screen, whatever the zoom. */
const HANDLE_SIZE = 12

/**
 * The selected node's outline and its resize handle (bottom-right), drawn
 * over the cards in canvas coordinates. The handle carries the node id, so
 * a press on it starts a resize in the board's drag.
 */
export function CanvasSelection({
  id,
  rect,
  zoom,
}: {
  id: string
  rect: CanvasRect
  zoom: number
}): ReactElement {
  const size = HANDLE_SIZE / zoom
  return (
    <div
      data-testid="canvas-selection"
      className="pointer-events-none absolute rounded-lg border-accent"
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        borderWidth: 2 / zoom,
      }}
    >
      <span
        data-canvas-node-id={id}
        data-canvas-resize
        aria-hidden
        className="pointer-events-auto absolute cursor-nwse-resize rounded-full border-surface bg-accent"
        style={{
          width: size,
          height: size,
          right: -size / 2,
          bottom: -size / 2,
          borderWidth: 2 / zoom,
        }}
      />
    </div>
  )
}
