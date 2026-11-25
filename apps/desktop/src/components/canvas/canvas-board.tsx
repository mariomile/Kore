import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
} from 'react'
import { canvasBounds, isBasePath, isCanvasPath, type CanvasDocument } from '@kore/core'
import { Locate, Plus } from '@/components/icons'
import { useAssetPersistence } from '@/editor/use-asset-persistence'
import { useWikiLinkNavigation } from '@/editor/use-wiki-link-navigation'
import { useNoteLinkNavigation } from '@/hooks/use-note-link-navigation'
import { useGraph } from '@/providers/graph-provider'
import { routeForPath } from '@/routing/route'
import { useRouter } from '@/routing/router'
import { cn } from '@/lib/utils'
import type { CanvasCardActions } from './canvas-card'
import { CanvasLayer } from './canvas-layer'
import { CanvasAddTools, CanvasToolBox, CanvasToolButton } from './canvas-toolbar'
import type { CanvasEditor } from './use-canvas'
import { useCanvasEditing } from './use-canvas-editing'

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
  /** Writes the file; null keeps the board a view (the iPhone). */
  editor: CanvasEditor | null
}

/**
 * The pannable, zoomable board a canvas is drawn on. Groups sit behind
 * cards and edges run between them in an SVG layer.
 *
 * Trackpad scroll pans, pinch (or ⌘/Ctrl + scroll) zooms around the
 * pointer, dragging the background pans; with the board focused, arrows
 * pan, `+`/`-` zoom and `0` fits the whole canvas.
 *
 * With an `editor` (the Mac) a card is clicked to select it, dragged to
 * move it (a group by its label, with the cards inside it) and resized by
 * its corner; a double click edits a text card, Backspace removes the
 * selection, ⌘Z undoes, and the bottom-left box adds note and text cards.
 */
export function CanvasBoard({ canvas: file, label, editor }: CanvasBoardProps): ReactElement {
  const boardRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<Viewport | null>(null)
  const editing = useCanvasEditing(file, editor)
  const { canvas } = editing
  const bounds = useMemo(() => canvasBounds(canvas.nodes), [canvas])
  const actions = useCardActions()

  // Fit reads the latest file but runs only on open and on `0`: an edit
  // must not move the view under the hand that made it.
  const fileRef = useRef(file)
  fileRef.current = file
  const fit = useCallback(() => {
    const board = boardRef.current
    if (board !== null) {
      setView(fitViewport(fileRef.current, board.clientWidth, board.clientHeight))
    }
  }, [])

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
    if (editing.pointerDown(event)) {
      event.currentTarget.focus({ preventScroll: true })
      return
    }
    if (event.button !== 0 || (event.target as Element).closest('[data-canvas-card]') !== null) {
      return
    }
    editing.select(null)
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (view !== null && editing.pointerMove(event, view.zoom)) {
      return
    }
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
    if (editing.pointerUp(event)) {
      return
    }
    if (drag.current?.pointerId === event.pointerId) {
      drag.current = null
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget || (editor !== null && editKey(event))) {
      return
    }
    if (event.metaKey || event.ctrlKey || event.altKey) {
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

  /** The board's editing keys; true when the key was one (and was handled). */
  const editKey = (event: KeyboardEvent<HTMLDivElement>): boolean => {
    const mod = event.metaKey || event.ctrlKey
    if (mod && !event.shiftKey && event.key.toLowerCase() === 'z') {
      void editor?.undo()
    } else if (!mod && (event.key === 'Backspace' || event.key === 'Delete')) {
      editing.removeSelected()
    } else if (event.key === 'Escape' && editing.selectedId !== null) {
      editing.select(null)
    } else {
      return false
    }
    event.preventDefault()
    return true
  }

  const onDoubleClick = (event: MouseEvent<HTMLDivElement>): void => {
    const id = (event.target as Element).closest<HTMLElement>('[data-canvas-node-id]')?.dataset
      .canvasNodeId
    if (id !== undefined && canvas.nodes.some((node) => node.id === id && node.type === 'text')) {
      editing.editText(id)
    }
  }

  /** The canvas point at the middle of the board: where a new card goes. */
  const boardCenter = (): { x: number; y: number } => {
    const board = boardRef.current
    if (board === null || view === null) {
      return { x: 0, y: 0 }
    }
    return {
      x: (board.clientWidth / 2 - view.x) / view.zoom,
      y: (board.clientHeight / 2 - view.y) / view.zoom,
    }
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
        onDoubleClick={editor === null ? undefined : onDoubleClick}
        className={cn(
          'absolute inset-0 cursor-grab touch-none overflow-hidden bg-surface-sunken outline-none active:cursor-grabbing',
          editing.dragging && 'select-none',
        )}
      >
        {view !== null && bounds !== null ? (
          <div
            className="absolute left-0 top-0 origin-top-left"
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
          >
            <CanvasLayer
              canvas={canvas}
              zoom={view.zoom}
              actions={actions}
              editable={editor !== null}
              editingId={editing.editingId}
              selectedId={editing.selectedId}
              onCommitText={editing.commitText}
            />
          </div>
        ) : null}
      </div>
      {editor === null ? null : (
        <CanvasAddTools
          onAddNote={(path) => {
            editing.add({ type: 'file', file: path }, boardCenter())
          }}
          onAddText={() => {
            editing.add({ type: 'text' }, boardCenter())
          }}
        />
      )}
      <CanvasToolBox className="right-3">
        <CanvasToolButton label="Zoom out" onClick={() => zoomBy(1 / 1.2)}>
          <span aria-hidden className="text-base leading-none">
            −
          </span>
        </CanvasToolButton>
        <span className="w-11 text-center text-xs tabular-nums text-text-muted">
          {view === null ? '' : `${Math.round(view.zoom * 100)}%`}
        </span>
        <CanvasToolButton label="Zoom in" onClick={() => zoomBy(1.2)}>
          <Plus aria-hidden className="size-3.5" />
        </CanvasToolButton>
        <CanvasToolButton label="Fit canvas" onClick={fit}>
          <Locate aria-hidden className="size-3.5" />
        </CanvasToolButton>
      </CanvasToolBox>
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
