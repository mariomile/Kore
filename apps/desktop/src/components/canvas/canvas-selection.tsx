import type { ReactElement, ReactNode } from 'react'
import type { CanvasEdgeLayout, CanvasNode, CanvasShape, CanvasSide } from '@kore/core'
import { Trash } from '@/components/icons'
import { cn } from '@/lib/utils'
import { CANVAS_COLOR_PRESETS, canvasColor } from './canvas-colors'
import { CANVAS_TOOL_BOX, CanvasToolButton } from './canvas-toolbar'

/** A handle's diameter on screen, whatever the zoom. */
const HANDLE_SIZE = 12

/** The gap between a selection and its menu, on screen. */
const MENU_GAP = 12

const SIDES: readonly CanvasSide[] = ['top', 'right', 'bottom', 'left']

/** Where a side's connector dot sits, as a fraction of the node's box. */
const SIDE_AT: Record<CanvasSide, { readonly x: number; readonly y: number }> = {
  top: { x: 0.5, y: 0 },
  right: { x: 1, y: 0.5 },
  bottom: { x: 0.5, y: 1 },
  left: { x: 0, y: 0.5 },
}

/** The shapes a text card takes, null being the default rounded rectangle. */
const SHAPES: readonly {
  readonly shape: CanvasShape | null
  readonly label: string
  readonly icon: ReactNode
}[] = [
  { shape: null, label: 'Rectangle', icon: <rect x="2" y="4" width="12" height="8" rx="1.5" /> },
  { shape: 'pill', label: 'Pill', icon: <rect x="1.5" y="4" width="13" height="8" rx="4" /> },
  { shape: 'diamond', label: 'Diamond', icon: <polygon points="8,1.5 14.5,8 8,14.5 1.5,8" /> },
  { shape: 'circle', label: 'Circle', icon: <circle cx="8" cy="8" r="6" /> },
  {
    shape: 'parallelogram',
    label: 'Parallelogram',
    icon: <polygon points="4.5,4 15,4 11.5,12 1,12" />,
  },
]

interface MenuActions {
  onColor: (color: string | null) => void
  onRemove: () => void
}

/**
 * The selection's floating menu, anchored at `at` (canvas units) and drawn
 * at screen size above it: counter-scaled so it reads the same at any zoom.
 */
function SelectionMenu({
  at,
  zoom,
  color,
  onColor,
  onRemove,
  children,
}: MenuActions & {
  at: { readonly x: number; readonly y: number }
  zoom: number
  color: string | null
  children?: ReactNode
}): ReactElement {
  return (
    <div
      data-canvas-ui
      data-testid="canvas-selection-menu"
      className={cn('pointer-events-auto absolute origin-top-left', CANVAS_TOOL_BOX)}
      style={{
        left: at.x,
        top: at.y,
        transform: `scale(${1 / zoom}) translate(-50%, calc(-100% - ${MENU_GAP}px))`,
      }}
      onPointerDown={(event) => {
        // A press in the menu is not a press on the board or the card under it.
        event.stopPropagation()
      }}
    >
      <ColorSwatches color={color} onColor={onColor} />
      {children}
      <CanvasToolButton label="Delete" onClick={onRemove}>
        <Trash aria-hidden className="size-3.5" />
      </CanvasToolButton>
    </div>
  )
}

function ColorSwatches({
  color,
  onColor,
}: {
  color: string | null
  onColor: (color: string | null) => void
}): ReactElement {
  return (
    <div role="radiogroup" aria-label="Color" className="flex items-center px-0.5">
      {[null, ...CANVAS_COLOR_PRESETS].map((preset) => {
        const fill = canvasColor(preset)
        const checked = preset === color
        return (
          <button
            key={preset ?? 'none'}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={preset === null ? 'No color' : `Color ${preset}`}
            title={preset === null ? 'No color' : undefined}
            onClick={() => {
              onColor(preset)
            }}
            className={cn(
              'flex size-7 items-center justify-center rounded-md transition-colors hover:bg-surface-hover',
              checked && 'bg-surface-active',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'size-3.5 rounded-full',
                fill === null && 'border border-border-strong bg-surface',
              )}
              style={fill === null ? undefined : { backgroundColor: fill }}
            />
          </button>
        )
      })}
    </div>
  )
}

/**
 * The selected node's outline, resize handle (bottom-right), connector dots
 * (one per side: pull one onto another card to draw an arrow) and menu. The
 * handles carry the node id, so a press on one starts the board's gesture.
 */
export function CanvasNodeSelection({
  node,
  zoom,
  editable,
  onColor,
  onShape,
  onRemove,
}: MenuActions & {
  node: CanvasNode
  zoom: number
  editable: boolean
  onShape: (shape: CanvasShape | null) => void
}): ReactElement {
  const size = HANDLE_SIZE / zoom
  const handle = {
    width: size,
    height: size,
    borderWidth: 2 / zoom,
  }
  const handleClass = 'pointer-events-auto absolute rounded-full border-surface bg-accent'
  return (
    <>
      <div
        data-testid="canvas-selection"
        className="pointer-events-none absolute rounded-lg border-accent"
        style={{
          left: node.x,
          top: node.y,
          width: node.width,
          height: node.height,
          borderWidth: 2 / zoom,
        }}
      >
        {editable ? (
          <>
            <span
              data-canvas-node-id={node.id}
              data-canvas-resize
              aria-hidden
              className={cn(handleClass, 'cursor-nwse-resize')}
              style={{ ...handle, right: -size / 2, bottom: -size / 2 }}
            />
            {SIDES.map((side) => (
              <span
                key={side}
                data-canvas-node-id={node.id}
                data-canvas-connect={side}
                aria-hidden
                className={cn(handleClass, 'cursor-crosshair')}
                style={{
                  ...handle,
                  left: `calc(${SIDE_AT[side].x * 100}% - ${size / 2}px)`,
                  top: `calc(${SIDE_AT[side].y * 100}% - ${size / 2}px)`,
                }}
              />
            ))}
          </>
        ) : null}
      </div>
      {editable ? (
        <SelectionMenu
          at={{ x: node.x + node.width / 2, y: node.y }}
          zoom={zoom}
          color={node.color}
          onColor={onColor}
          onRemove={onRemove}
        >
          {node.type === 'text'
            ? SHAPES.map(({ shape, label, icon }) => (
                <CanvasToolButton
                  key={label}
                  label={label}
                  pressed={node.shape === shape}
                  onClick={() => {
                    onShape(shape)
                  }}
                >
                  <svg
                    aria-hidden
                    viewBox="0 0 16 16"
                    className="size-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    strokeLinejoin="round"
                  >
                    {icon}
                  </svg>
                </CanvasToolButton>
              ))
            : null}
        </SelectionMenu>
      ) : null}
    </>
  )
}

/** The selected edge's menu, over the middle of its path. */
export function CanvasEdgeSelection({
  layout,
  zoom,
  onColor,
  onRemove,
}: MenuActions & { layout: CanvasEdgeLayout; zoom: number }): ReactElement {
  return (
    <SelectionMenu
      at={layout.labelAt}
      zoom={zoom}
      color={layout.edge.color}
      onColor={onColor}
      onRemove={onRemove}
    />
  )
}
