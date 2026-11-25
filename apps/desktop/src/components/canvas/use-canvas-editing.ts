import { useCallback, useMemo, useRef, useState, type PointerEvent } from 'react'
import {
  CANVAS_GROUP_SIZE,
  CANVAS_MIN_SIZE,
  CANVAS_NOTE_SIZE,
  CANVAS_TEXT_SIZE,
  canvasFreeSpot,
  canvasNodeAt,
  nearestSide,
  newCanvasNodeId,
  nodesInsideGroup,
  snapToCanvasGrid,
  type CanvasDocument,
  type CanvasNode,
  type CanvasPoint,
  type CanvasRect,
  type CanvasShape,
  type CanvasSide,
} from '@kore/core'
import type { CanvasEditor } from './use-canvas'

/** Pointer travel (screen px) before a press on a card becomes a drag, so clicks still click. */
const DRAG_THRESHOLD = 4

/** A press on these stays theirs: links, buttons and the text being edited. */
const INTERACTIVE = 'a, button, input, textarea, [role="link"], [role="button"]'

/** Where the board is: what a pointer's screen position means in canvas units. */
export interface CanvasViewport {
  readonly zoom: number
  readonly toCanvas: (clientX: number, clientY: number) => CanvasPoint
}

/** An arrow being pulled out of a node's side, its loose end at `to`. */
export interface PendingEdge {
  readonly fromNode: string
  readonly fromSide: CanvasSide
  readonly to: CanvasPoint
}

interface ConnectGesture {
  readonly pointerId: number
  readonly kind: 'connect'
  readonly fromNode: string
  readonly fromSide: CanvasSide
}

type Gesture = ConnectGesture | PlaceGesture

interface PlaceGesture {
  readonly pointerId: number
  readonly kind: 'move' | 'resize'
  /** The pressed node, then (for a group) the nodes inside it. */
  readonly ids: readonly string[]
  readonly origins: ReadonlyMap<string, CanvasRect>
  readonly startX: number
  readonly startY: number
  dragging: boolean
  /** Where the drag has put the nodes so far (what release writes). */
  rects: ReadonlyMap<string, CanvasRect>
}

export type NewCard = { type: 'file'; file: string } | { type: 'text' } | { type: 'group' }

export interface CanvasEditing {
  /** The canvas as drawn: the file's nodes with the rect a live drag gives them. */
  readonly canvas: CanvasDocument
  /** The selected node or edge. */
  readonly selectedId: string | null
  /** The text card (or group label) being edited. */
  readonly editingId: string | null
  /** The arrow being pulled out, while it is. */
  readonly pendingEdge: PendingEdge | null
  /** True while a card is being dragged or resized. */
  readonly dragging: boolean
  /** Board pointer handlers; each returns whether the press was a card's (not a pan). */
  readonly pointerDown: (event: PointerEvent<HTMLElement>) => boolean
  readonly pointerMove: (event: PointerEvent<HTMLElement>, viewport: CanvasViewport) => boolean
  readonly pointerUp: (event: PointerEvent<HTMLElement>, viewport: CanvasViewport) => boolean
  readonly select: (id: string | null) => void
  /** Edit a text card's text or a group's label. */
  readonly editText: (id: string) => void
  /** End editing: the new text (a group's label), or null to keep it. */
  readonly commitText: (id: string, text: string | null) => void
  readonly removeSelected: () => void
  /** Colour the selection: a preset `"1"`–`"6"`, or null for none. */
  readonly colorSelected: (color: string | null) => void
  /** Shape the selected text card; null for the plain rounded rectangle. */
  readonly shapeSelected: (shape: CanvasShape | null) => void
  /** Add a card centred on `center` (canvas units), in free space. */
  readonly add: (card: NewCard, center: { x: number; y: number }) => void
}

function rectOf(node: CanvasNode): CanvasRect {
  return { x: node.x, y: node.y, width: node.width, height: node.height }
}

/**
 * Move, resize, add, remove, retext, colour and shape the cards of an
 * editable board, and pull arrows between them. A drag only redraws locally (the dragged rects override the file's); the
 * file is written once, on release, through `editor`. With no editor (the
 * iPhone) nothing is pressable and the board is a view.
 */
export function useCanvasEditing(file: CanvasDocument, editor: CanvasEditor | null): CanvasEditing {
  const [overrides, setOverrides] = useState<ReadonlyMap<string, CanvasRect>>(new Map())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [pendingEdge, setPendingEdge] = useState<PendingEdge | null>(null)
  const gesture = useRef<Gesture | null>(null)

  const canvas = useMemo((): CanvasDocument => {
    if (overrides.size === 0) {
      return file
    }
    // Untouched nodes keep their identity, so only the dragged cards redraw.
    return {
      ...file,
      nodes: file.nodes.map((node) => {
        const rect = overrides.get(node.id)
        return rect === undefined ? node : { ...node, ...rect }
      }),
    }
  }, [file, overrides])

  const pointerDown = useCallback(
    (event: PointerEvent<HTMLElement>): boolean => {
      const target = event.target as Element
      if (editor === null || event.button !== 0 || target.closest(INTERACTIVE) !== null) {
        return false
      }
      const edge = target.closest<SVGElement>('[data-canvas-edge-id]')
      if (edge !== null) {
        setEditingId(null)
        setSelectedId(edge.dataset.canvasEdgeId!)
        return true
      }
      const element = target.closest<HTMLElement>('[data-canvas-node-id]')
      if (element === null) {
        return false
      }
      const id = element.dataset.canvasNodeId!
      const connectSide = element.dataset.canvasConnect as CanvasSide | undefined
      if (connectSide !== undefined) {
        gesture.current = {
          pointerId: event.pointerId,
          kind: 'connect',
          fromNode: id,
          fromSide: connectSide,
        }
        event.currentTarget.setPointerCapture(event.pointerId)
        return true
      }
      const node = file.nodes.find((candidate) => candidate.id === id)
      if (node === undefined) {
        return false
      }
      const kind = target.closest('[data-canvas-resize]') === null ? 'move' : 'resize'
      const ids =
        kind === 'move' && node.type === 'group'
          ? [id, ...nodesInsideGroup(node, file.nodes)]
          : [id]
      const byId = new Map(file.nodes.map((candidate) => [candidate.id, candidate]))
      gesture.current = {
        pointerId: event.pointerId,
        kind,
        ids,
        origins: new Map(ids.map((nodeId) => [nodeId, rectOf(byId.get(nodeId)!)])),
        startX: event.clientX,
        startY: event.clientY,
        dragging: false,
        rects: new Map(),
      }
      return true
    },
    [editor, file],
  )

  const pointerMove = useCallback(
    (event: PointerEvent<HTMLElement>, { zoom, toCanvas }: CanvasViewport): boolean => {
      const current = gesture.current
      if (current === null || current.pointerId !== event.pointerId) {
        return false
      }
      if (current.kind === 'connect') {
        setPendingEdge({
          fromNode: current.fromNode,
          fromSide: current.fromSide,
          to: toCanvas(event.clientX, event.clientY),
        })
        return true
      }
      const screenDx = event.clientX - current.startX
      const screenDy = event.clientY - current.startY
      if (!current.dragging) {
        if (Math.hypot(screenDx, screenDy) < DRAG_THRESHOLD) {
          return true
        }
        // Captured only now: capturing on press would retarget the click of a
        // link inside the card to the board.
        current.dragging = true
        event.currentTarget.setPointerCapture(event.pointerId)
        setEditingId(null)
        setSelectedId(current.ids[0]!)
      }
      // Snapping the travel (not each card) keeps a group's cards spaced as they were.
      const dx = snapToCanvasGrid(screenDx / zoom)
      const dy = snapToCanvasGrid(screenDy / zoom)
      const next = new Map<string, CanvasRect>()
      for (const [id, origin] of current.origins) {
        next.set(
          id,
          current.kind === 'move'
            ? { ...origin, x: origin.x + dx, y: origin.y + dy }
            : {
                ...origin,
                width: Math.max(CANVAS_MIN_SIZE, origin.width + dx),
                height: Math.max(CANVAS_MIN_SIZE, origin.height + dy),
              },
        )
      }
      current.rects = next
      setOverrides(next)
      return true
    },
    [],
  )

  const pointerUp = useCallback(
    (event: PointerEvent<HTMLElement>, { toCanvas }: CanvasViewport): boolean => {
      const current = gesture.current
      if (current === null || current.pointerId !== event.pointerId) {
        return false
      }
      gesture.current = null
      if (current.kind === 'connect') {
        setPendingEdge(null)
        const point = toCanvas(event.clientX, event.clientY)
        const target = canvasNodeAt(file.nodes, point)
        if (target !== null && target.id !== current.fromNode && editor !== null) {
          const id = newCanvasNodeId()
          setSelectedId(id)
          void editor.apply([
            {
              kind: 'connect',
              id,
              fromNode: current.fromNode,
              fromSide: current.fromSide,
              toNode: target.id,
              toSide: nearestSide(target, point),
            },
          ])
        }
        return true
      }
      if (!current.dragging) {
        setSelectedId(current.ids[0]!)
        return true
      }
      const placed = [...current.rects].filter(([id, rect]) => {
        const origin = current.origins.get(id)!
        return (
          origin.x !== rect.x ||
          origin.y !== rect.y ||
          origin.width !== rect.width ||
          origin.height !== rect.height
        )
      })
      if (placed.length === 0 || editor === null) {
        setOverrides(new Map())
        return true
      }
      void editor.apply(placed.map(([id, rect]) => ({ kind: 'place', id, rect }))).finally(() => {
        setOverrides(new Map())
      })
      return true
    },
    [editor, file],
  )

  const editText = useCallback((id: string) => {
    setSelectedId(id)
    setEditingId(id)
  }, [])

  const commitText = useCallback(
    (id: string, text: string | null) => {
      setEditingId((current) => (current === id ? null : current))
      const node = file.nodes.find((candidate) => candidate.id === id)
      if (text !== null && node !== undefined) {
        void editor?.apply([
          node.type === 'group' ? { kind: 'label', id, label: text } : { kind: 'text', id, text },
        ])
      }
    },
    [editor, file],
  )

  const removeSelected = useCallback(() => {
    if (selectedId !== null && editor !== null) {
      setSelectedId(null)
      setEditingId(null)
      void editor.apply([{ kind: 'remove', ids: [selectedId] }])
    }
  }, [editor, selectedId])

  const colorSelected = useCallback(
    (color: string | null) => {
      if (selectedId !== null && editor !== null) {
        void editor.apply([{ kind: 'color', id: selectedId, color }])
      }
    },
    [editor, selectedId],
  )

  const shapeSelected = useCallback(
    (shape: CanvasShape | null) => {
      if (selectedId !== null && editor !== null) {
        void editor.apply([{ kind: 'shape', id: selectedId, shape }])
      }
    },
    [editor, selectedId],
  )

  const add = useCallback(
    (card: NewCard, center: { x: number; y: number }) => {
      if (editor === null) {
        return
      }
      const id = newCanvasNodeId()
      const size =
        card.type === 'file'
          ? CANVAS_NOTE_SIZE
          : card.type === 'group'
            ? CANVAS_GROUP_SIZE
            : CANVAS_TEXT_SIZE
      const rect = canvasFreeSpot(center, size, file.nodes)
      setSelectedId(id)
      setEditingId(card.type === 'file' ? null : id)
      void editor.apply([
        {
          kind: 'add',
          id,
          rect,
          card:
            card.type === 'file'
              ? card
              : card.type === 'group'
                ? { type: 'group', label: 'Group' }
                : { type: 'text', text: '' },
        },
      ])
    },
    [editor, file],
  )

  return {
    canvas,
    selectedId,
    editingId,
    pendingEdge,
    dragging: overrides.size > 0,
    pointerDown,
    pointerMove,
    pointerUp,
    select: setSelectedId,
    editText,
    commitText,
    removeSelected,
    colorSelected,
    shapeSelected,
    add,
  }
}
