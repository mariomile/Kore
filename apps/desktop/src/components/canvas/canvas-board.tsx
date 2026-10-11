import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
} from 'react'
import {
  canvasBounds,
  isBasePath,
  isCanvasPath,
  layoutCanvasEdges,
  type CanvasDocument,
  type CanvasNode,
} from '@reflect/core'
import { Locate, Plus } from '@/components/icons'
import { useAssetPersistence } from '@/editor/use-asset-persistence'
import { useWikiLinkNavigation } from '@/editor/use-wiki-link-navigation'
import { useNoteLinkNavigation } from '@/hooks/use-note-link-navigation'
import { useGraph } from '@/providers/graph-provider'
import { routeForPath } from '@/routing/route'
import { useRouter } from '@/routing/router'
import { canvasColor } from './canvas-colors'
import { CanvasCard, type CanvasCardActions } from './canvas-card'

interface Viewport {
  /** Screen offset of the canvas origin inside the board. */
  readonly x: number
  readonly y: number
  readonly zoom: number
}

const MIN_ZOOM = 0.1
const MAX_ZOOM = 2.5
const FIT_PADDING = 48
const KEY_PAN_STEP = 80

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

function fitViewport(canvas: CanvasDocument, width: number, height: number): Viewport {
  const bounds = canvasBounds(canvas.nodes)
  if (bounds === null || width <= 0 || height <= 0) {
    return { x: 0, y: 0, zoom: 1 }
  }
  const zoom = clampZoom(
    Math.min(
      (width - FIT_PADDING * 2) / bounds.width,
      (height - FIT_PADDING * 2) / bounds.height,
      1,
    ),
  )
  return {
    x: (width - bounds.width * zoom) / 2 - bounds.x * zoom,
    y: (height - bounds.height * zoom) / 2 - bounds.y * zoom,
    zoom,
  }
}

/** Zoom by `factor`, keeping the canvas point under (`cx`, `cy`) in place. */
function zoomAround(view: Viewport, factor: number, cx: number, cy: number): Viewport {
  const zoom = clampZoom(view.zoom * factor)
  const scale = zoom / view.zoom
  return { x: cx - (cx - view.x) * scale, y: cy - (cy - view.y) * scale, zoom }
}

/** Whether the wheel event should scroll a card's own overflowing body instead. */
function scrollsInsideCard(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false
  }
  const scroller = target.closest<HTMLElement>('[data-canvas-scroll]')
  return scroller !== null && scroller.scrollHeight > scroller.clientHeight + 1
}

interface CanvasBoardProps {
  canvas: CanvasDocument
  /** Accessible name of the board (the canvas's name). */
  label: string
}

/**
 * The pannable, zoomable board a canvas is drawn on. Groups sit behind
 * cards, edges run between them in an SVG layer, and nothing on the board
 * can move or change: it is a view of the file.
 *
 * Trackpad scroll pans, pinch (or ⌘/Ctrl + scroll) zooms around the
 * pointer, dragging the background pans; with the board focused, arrows
 * pan, `+`/`-` zoom and `0` fits the whole canvas.
 */
export function CanvasBoard({ canvas, label }: CanvasBoardProps): ReactElement {
  const boardRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<Viewport | null>(null)
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
  const bounds = useMemo(() => canvasBounds(canvas.nodes), [canvas])
  const actions = useCardActions()

  const fit = useCallback(() => {
    const board = boardRef.current
    if (board !== null) {
      setView(fitViewport(canvas, board.clientWidth, board.clientHeight))
    }
  }, [canvas])

  useLayoutEffect(() => {
    fit()
  }, [fit])

  const zoomBy = useCallback((factor: number) => {
    const board = boardRef.current
    setView((current) =>
      current === null || board === null
        ? current
        : zoomAround(current, factor, board.clientWidth / 2, board.clientHeight / 2),
    )
  }, [])

  // React's wheel listener is passive, so the board registers its own to
  // keep the page (and the webview's pinch-zoom) from moving instead.
  useEffect(() => {
    const board = boardRef.current
    if (board === null) {
      return
    }
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey && scrollsInsideCard(event.target)) {
        return
      }
      event.preventDefault()
      const rect = board.getBoundingClientRect()
      setView((current) => {
        if (current === null) {
          return current
        }
        if (event.ctrlKey || event.metaKey) {
          const factor = Math.exp(-event.deltaY * 0.01)
          return zoomAround(current, factor, event.clientX - rect.left, event.clientY - rect.top)
        }
        return { ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }
      })
    }
    board.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      board.removeEventListener('wheel', onWheel)
    }
  }, [])

  const drag = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || (event.target as Element).closest('[data-canvas-card]') !== null) {
      return
    }
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const start = drag.current
    if (start === null || start.pointerId !== event.pointerId) {
      return
    }
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    drag.current = { ...start, x: event.clientX, y: event.clientY }
    setView((current) =>
      current === null ? current : { ...current, x: current.x + dx, y: current.y + dy },
    )
  }
  const endDrag = (event: PointerEvent<HTMLDivElement>): void => {
    if (drag.current?.pointerId === event.pointerId) {
      drag.current = null
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget || event.metaKey || event.ctrlKey || event.altKey) {
      return
    }
    const pan = (dx: number, dy: number): void => {
      setView((current) =>
        current === null ? current : { ...current, x: current.x + dx, y: current.y + dy },
      )
    }
    switch (event.key) {
      case 'ArrowLeft':
        pan(KEY_PAN_STEP, 0)
        break
      case 'ArrowRight':
        pan(-KEY_PAN_STEP, 0)
        break
      case 'ArrowUp':
        pan(0, KEY_PAN_STEP)
        break
      case 'ArrowDown':
        pan(0, -KEY_PAN_STEP)
        break
      case '+':
      case '=':
        zoomBy(1.2)
        break
      case '-':
        zoomBy(1 / 1.2)
        break
      case '0':
        fit()
        break
      default:
        return
    }
    event.preventDefault()
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={boardRef}
        role="region"
        aria-label={`Canvas ${label}`}
        aria-roledescription="canvas"
        tabIndex={0}
        data-testid="canvas-board"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        className="absolute inset-0 cursor-grab touch-none overflow-hidden bg-surface-sunken outline-none active:cursor-grabbing"
      >
        {view !== null && bounds !== null ? (
          <div
            className="absolute left-0 top-0 origin-top-left"
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
          >
            {nodes.map((node) => (
              <CanvasCard key={node.id} node={node} zoom={view.zoom} actions={actions} />
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
                  className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded bg-surface-sunken px-1.5 py-0.5 text-xs text-text-secondary"
                  style={{ left: layout.labelAt.x, top: layout.labelAt.y }}
                >
                  {layout.edge.label}
                </span>
              ),
            )}
          </div>
        ) : null}
      </div>
      <div className="absolute bottom-3 right-3 flex items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5 shadow-sm">
        <ZoomButton label="Zoom out" onClick={() => zoomBy(1 / 1.2)}>
          <span aria-hidden className="text-base leading-none">
            −
          </span>
        </ZoomButton>
        <span className="w-11 text-center text-xs tabular-nums text-text-muted">
          {view === null ? '' : `${Math.round(view.zoom * 100)}%`}
        </span>
        <ZoomButton label="Zoom in" onClick={() => zoomBy(1.2)}>
          <Plus aria-hidden className="size-3.5" />
        </ZoomButton>
        <ZoomButton label="Fit canvas" onClick={fit}>
          <Locate aria-hidden className="size-3.5" />
        </ZoomButton>
      </div>
    </div>
  )
}

/** Navigation for the cards: notes, wiki links, files, images. */
function useCardActions(): CanvasCardActions {
  const { graph } = useGraph()
  const generation = graph?.generation ?? null
  const { navigate } = useRouter()
  const navigateNoteLink = useNoteLinkNavigation()
  const openWikiLink = useWikiLinkNavigation(generation)
  const { resolveImageUrl, openAsset } = useAssetPersistence(generation)
  return useMemo(
    (): CanvasCardActions => ({
      openNote: (path, openInSplit) => {
        navigateNoteLink({ target: routeForPath(path), openInSplit })
      },
      openWikiLink,
      openFile: (path) => {
        if (isCanvasPath(path)) {
          navigate({ kind: 'canvas', path })
        } else if (isBasePath(path)) {
          navigate({ kind: 'base', path, view: null })
        } else {
          void openAsset(path)
        }
      },
      resolveImageUrl,
    }),
    [navigate, navigateNoteLink, openAsset, openWikiLink, resolveImageUrl],
  )
}

function ZoomButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactElement
}): ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
    >
      {children}
    </button>
  )
}
