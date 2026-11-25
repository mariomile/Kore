import { memo, useMemo, type ReactElement } from 'react'
import { layoutCanvasEdges, type CanvasDocument, type CanvasNode } from '@kore/core'
import { canvasColor } from './canvas-colors'
import { CanvasCard, PREVIEW_MIN_ZOOM, type CanvasCardActions } from './canvas-card'
import { CanvasSelection } from './canvas-selection'

interface CanvasLayerProps {
  /** The canvas as drawn (a live drag already applied). */
  canvas: CanvasDocument
  zoom: number
  actions: CanvasCardActions
  editable: boolean
  editingId: string | null
  selectedId: string | null
  onCommitText: (id: string, text: string | null) => void
}

/**
 * Everything drawn in canvas coordinates: groups, cards, edges, their
 * labels and the selection. Memoised apart from the board so a pan (which
 * only moves the transform around it) re-renders nothing here.
 */
export const CanvasLayer = memo(function CanvasLayer({
  canvas,
  zoom,
  actions,
  editable,
  editingId,
  selectedId,
  onCommitText,
}: CanvasLayerProps): ReactElement {
  const edges = useMemo(() => layoutCanvasEdges(canvas), [canvas])
  // Groups first so they stay behind the cards they hold; file order
  // (JSON Canvas's z-order) is kept within each layer.
  const nodes = useMemo(
    (): CanvasNode[] => [
      ...canvas.nodes.filter((node) => node.type === 'group'),
      ...canvas.nodes.filter((node) => node.type !== 'group'),
    ],
    [canvas],
  )
  const selected =
    selectedId === null ? undefined : canvas.nodes.find((node) => node.id === selectedId)
  return (
    <>
      {nodes.map((node) => (
        <CanvasCard
          key={node.id}
          node={node}
          preview={zoom >= PREVIEW_MIN_ZOOM}
          actions={actions}
          editable={editable}
          editingText={node.id === editingId}
          onCommitText={onCommitText}
        />
      ))}
      <svg
        aria-hidden
        className="pointer-events-none absolute overflow-visible"
        style={{ left: 0, top: 0, width: 1, height: 1 }}
      >
        {edges.map((layout) => {
          const color = canvasColor(layout.edge.color) ?? 'var(--color-text-muted)'
          return (
            <g key={layout.edge.id} data-testid="canvas-edge">
              <path d={layout.path} fill="none" stroke={color} strokeWidth={2} />
              {layout.arrows.map((points) => (
                <polygon key={points} points={points} fill={color} />
              ))}
            </g>
          )
        })}
      </svg>
      {edges.map((layout) =>
        layout.edge.label === null ? null : (
          <span
            key={layout.edge.id}
            className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-sm bg-surface-sunken px-1.5 py-0.5 text-xs text-text-secondary"
            style={{ left: layout.labelAt.x, top: layout.labelAt.y }}
          >
            {layout.edge.label}
          </span>
        ),
      )}
      {selected === undefined ? null : (
        <CanvasSelection id={selected.id} rect={selected} zoom={zoom} />
      )}
    </>
  )
})
