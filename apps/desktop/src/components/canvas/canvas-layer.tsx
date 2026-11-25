import { memo, useMemo, type ReactElement } from 'react'
import {
  layoutCanvasEdge,
  layoutCanvasEdges,
  type CanvasDocument,
  type CanvasEdgeLayout,
  type CanvasNode,
  type CanvasShape,
} from '@kore/core'
import { canvasColor } from './canvas-colors'
import { CanvasCard, PREVIEW_MIN_ZOOM, type CanvasCardActions } from './canvas-card'
import { CanvasEdgeSelection, CanvasNodeSelection } from './canvas-selection'
import type { PendingEdge } from './use-canvas-editing'

interface CanvasLayerProps {
  /** The canvas as drawn (a live drag already applied). */
  canvas: CanvasDocument
  zoom: number
  actions: CanvasCardActions
  editable: boolean
  editingId: string | null
  /** The selected node or edge. */
  selectedId: string | null
  pendingEdge: PendingEdge | null
  onCommitText: (id: string, text: string | null) => void
  onColor: (color: string | null) => void
  onShape: (shape: CanvasShape | null) => void
  onRemove: () => void
}

/** Screen pixels around an edge that still pick it. */
const EDGE_HIT_WIDTH = 14

/** The arrow being pulled out, laid out like an edge whose far end is the pointer. */
function pendingLayout(
  pending: PendingEdge,
  nodes: readonly CanvasNode[],
): CanvasEdgeLayout | null {
  const from = nodes.find((node) => node.id === pending.fromNode)
  if (from === undefined) {
    return null
  }
  return layoutCanvasEdge(
    {
      id: 'pending',
      fromNode: from.id,
      toNode: 'pointer',
      fromSide: pending.fromSide,
      toSide: null,
      fromArrow: false,
      toArrow: true,
      color: null,
      label: null,
    },
    from,
    { ...pending.to, width: 0, height: 0 },
  )
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
  pendingEdge,
  onCommitText,
  onColor,
  onShape,
  onRemove,
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
  const selectedNode =
    selectedId === null ? undefined : canvas.nodes.find((node) => node.id === selectedId)
  const selectedEdge =
    selectedId === null ? undefined : edges.find((layout) => layout.edge.id === selectedId)
  const pending = pendingEdge === null ? null : pendingLayout(pendingEdge, canvas.nodes)
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
          const selected = layout === selectedEdge
          const color = selected
            ? 'var(--color-accent)'
            : (canvasColor(layout.edge.color) ?? 'var(--color-text-muted)')
          return (
            <g key={layout.edge.id} data-testid="canvas-edge">
              <path d={layout.path} fill="none" stroke={color} strokeWidth={selected ? 3 : 2} />
              {layout.arrows.map((points) => (
                <polygon key={points} points={points} fill={color} />
              ))}
              {editable ? (
                <path
                  d={layout.path}
                  data-canvas-edge-id={layout.edge.id}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={EDGE_HIT_WIDTH}
                  vectorEffect="non-scaling-stroke"
                  className="cursor-pointer"
                  style={{ pointerEvents: 'stroke' }}
                />
              ) : null}
            </g>
          )
        })}
        {pending === null ? null : (
          <g data-testid="canvas-pending-edge">
            <path d={pending.path} fill="none" stroke="var(--color-accent)" strokeWidth={2} />
            {pending.arrows.map((points) => (
              <polygon key={points} points={points} fill="var(--color-accent)" />
            ))}
          </g>
        )}
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
      {selectedNode === undefined ? null : (
        <CanvasNodeSelection
          node={selectedNode}
          zoom={zoom}
          editable={editable}
          onColor={onColor}
          onShape={onShape}
          onRemove={onRemove}
        />
      )}
      {selectedEdge === undefined || !editable ? null : (
        <CanvasEdgeSelection
          layout={selectedEdge}
          zoom={zoom}
          onColor={onColor}
          onRemove={onRemove}
        />
      )}
    </>
  )
})
