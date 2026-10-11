import type { CanvasDocument, CanvasEdge, CanvasNode, CanvasSide } from './canvas-file'

/**
 * Where a canvas's nodes and edges land in canvas coordinates. Pure math so
 * the screen only places what this computes; the curve shape follows
 * Obsidian's (a cubic leaving each node straight out of its side).
 */

export interface CanvasPoint {
  readonly x: number
  readonly y: number
}

export interface CanvasRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface CanvasEdgeLayout {
  readonly edge: CanvasEdge
  /** SVG path data of the curve. */
  readonly path: string
  /** Arrowhead triangles (SVG `points`), one per arrow end. */
  readonly arrows: readonly string[]
  /** Where the label sits: the curve's midpoint. */
  readonly labelAt: CanvasPoint
}

const NORMALS: Record<CanvasSide, CanvasPoint> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
}

const ARROW_LENGTH = 12
const ARROW_HALF_WIDTH = 6

/** The smallest rectangle around every node, or null for an empty canvas. */
export function canvasBounds(nodes: readonly CanvasNode[]): CanvasRect | null {
  if (nodes.length === 0) {
    return null
  }
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const node of nodes) {
    left = Math.min(left, node.x)
    top = Math.min(top, node.y)
    right = Math.max(right, node.x + node.width)
    bottom = Math.max(bottom, node.y + node.height)
  }
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** The midpoint of `side` of `node`, where an edge attaches. */
export function sideAnchor(node: CanvasRect, side: CanvasSide): CanvasPoint {
  switch (side) {
    case 'top':
      return { x: node.x + node.width / 2, y: node.y }
    case 'right':
      return { x: node.x + node.width, y: node.y + node.height / 2 }
    case 'bottom':
      return { x: node.x + node.width / 2, y: node.y + node.height }
    case 'left':
      return { x: node.x, y: node.y + node.height / 2 }
  }
}

function center(node: CanvasRect): CanvasPoint {
  return { x: node.x + node.width / 2, y: node.y + node.height / 2 }
}

/** The side of `node` that faces `toward`, for an edge that names none. */
export function facingSide(node: CanvasRect, toward: CanvasRect): CanvasSide {
  const from = center(node)
  const to = center(toward)
  const dx = (to.x - from.x) / Math.max(node.width, 1)
  const dy = (to.y - from.y) / Math.max(node.height, 1)
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? 'right' : 'left'
  }
  return dy >= 0 ? 'bottom' : 'top'
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}

function arrowAt(tip: CanvasPoint, side: CanvasSide): string {
  // The arrow points into the node, against its side's outward normal.
  const normal = NORMALS[side]
  const baseX = tip.x + normal.x * ARROW_LENGTH
  const baseY = tip.y + normal.y * ARROW_LENGTH
  const left = { x: baseX - normal.y * ARROW_HALF_WIDTH, y: baseY + normal.x * ARROW_HALF_WIDTH }
  const right = { x: baseX + normal.y * ARROW_HALF_WIDTH, y: baseY - normal.x * ARROW_HALF_WIDTH }
  return [tip, left, right].map((point) => `${round(point.x)},${round(point.y)}`).join(' ')
}

function cubicPoint(
  p0: CanvasPoint,
  p1: CanvasPoint,
  p2: CanvasPoint,
  p3: CanvasPoint,
  t: number,
): CanvasPoint {
  const u = 1 - t
  const a = u * u * u
  const b = 3 * u * u * t
  const c = 3 * u * t * t
  const d = t * t * t
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  }
}

/** Lay out one edge between two placed nodes. */
export function layoutCanvasEdge(
  edge: CanvasEdge,
  from: CanvasRect,
  to: CanvasRect,
): CanvasEdgeLayout {
  const fromSide = edge.fromSide ?? facingSide(from, to)
  const toSide = edge.toSide ?? facingSide(to, from)
  const start = sideAnchor(from, fromSide)
  const end = sideAnchor(to, toSide)
  const distance = Math.hypot(end.x - start.x, end.y - start.y)
  const reach = Math.min(Math.max(distance / 2, 40), 200)
  const c1 = {
    x: start.x + NORMALS[fromSide].x * reach,
    y: start.y + NORMALS[fromSide].y * reach,
  }
  const c2 = { x: end.x + NORMALS[toSide].x * reach, y: end.y + NORMALS[toSide].y * reach }
  const arrows: string[] = []
  if (edge.fromArrow) {
    arrows.push(arrowAt(start, fromSide))
  }
  if (edge.toArrow) {
    arrows.push(arrowAt(end, toSide))
  }
  const point = (p: CanvasPoint): string => `${round(p.x)} ${round(p.y)}`
  return {
    edge,
    path: `M ${point(start)} C ${point(c1)}, ${point(c2)}, ${point(end)}`,
    arrows,
    labelAt: cubicPoint(start, c1, c2, end, 0.5),
  }
}

/** Every edge of `canvas`, laid out. */
export function layoutCanvasEdges(canvas: CanvasDocument): CanvasEdgeLayout[] {
  const byId = new Map(canvas.nodes.map((node) => [node.id, node]))
  return canvas.edges.flatMap((edge) => {
    const from = byId.get(edge.fromNode)
    const to = byId.get(edge.toNode)
    return from === undefined || to === undefined ? [] : [layoutCanvasEdge(edge, from, to)]
  })
}
