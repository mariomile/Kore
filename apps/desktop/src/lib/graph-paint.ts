/**
 * Batched canvas painting for the Graph view. A vault-sized map has thousands
 * of circles and tens of thousands of edges, and each `stroke()`/`fill()` call
 * costs far more than the shape it draws, so shapes share paths instead of
 * getting one call each.
 */

import type { GraphLayoutEdge } from './graph-layout'

interface Point {
  x: number
  y: number
}

/** How an edge reads against the current hover and header search. */
export type EdgeStyle = 'base' | 'context' | 'searchDim' | 'lit'

/** Paint order: the spotlight's lit edges go on top of the rest. */
const EDGE_STYLE_ORDER: readonly EdgeStyle[] = ['base', 'context', 'searchDim', 'lit']
const EDGE_ALPHA: Record<EdgeStyle, number> = { base: 1, context: 0.35, searchDim: 0.2, lit: 0.9 }

/**
 * Paths per edge style. Not one: translucent strokes darken where edges
 * overlap — that is how a dense cluster reads as dense — and a single path
 * composites only once. Dealing edges round-robin over a few paths keeps
 * almost all of that layering.
 */
const EDGE_LAYERS = 16

/** Stroke every edge, batched by style (see {@link EDGE_LAYERS}). */
export function paintEdges(
  ctx: CanvasRenderingContext2D,
  positions: readonly Point[],
  edges: readonly GraphLayoutEdge[],
  styleOf: (edge: GraphLayoutEdge) => EdgeStyle,
  colors: { accent: string; border: string },
  scale: number,
): void {
  const layers = (): GraphLayoutEdge[][] => Array.from({ length: EDGE_LAYERS }, () => [])
  const byStyle: Record<EdgeStyle, GraphLayoutEdge[][]> = {
    base: layers(),
    context: layers(),
    searchDim: layers(),
    lit: layers(),
  }
  for (const [position, edge] of edges.entries()) {
    byStyle[styleOf(edge)][position % EDGE_LAYERS]?.push(edge)
  }
  for (const style of EDGE_STYLE_ORDER) {
    ctx.strokeStyle = style === 'lit' ? colors.accent : colors.border
    ctx.globalAlpha = EDGE_ALPHA[style]
    ctx.lineWidth = (style === 'lit' ? 1.6 : 1) / scale
    for (const layer of byStyle[style]) {
      if (layer.length === 0) {
        continue
      }
      ctx.beginPath()
      for (const edge of layer) {
        const source = positions[edge.source]
        const target = positions[edge.target]
        if (source !== undefined && target !== undefined) {
          ctx.moveTo(source.x, source.y)
          ctx.lineTo(target.x, target.y)
        }
      }
      ctx.stroke()
    }
  }
}

/** One circle's paint: its fill, and whether it recedes or carries the accent. */
export interface CircleStyle {
  fill: string
  receded: boolean
  accent: boolean
}

/**
 * Fill every circle, one path per fill. Opaque fills look the same however
 * they are grouped; receded circles paint first and accents last, on top.
 */
export function paintCircles(
  ctx: CanvasRenderingContext2D,
  positions: readonly Point[],
  styleOf: (index: number) => CircleStyle,
  radiusOf: (index: number) => number,
): void {
  const batches = new Map<string, { style: CircleStyle; indexes: number[] }>()
  for (const index of positions.keys()) {
    const style = styleOf(index)
    const key = `${style.receded ? 0 : 1}${style.accent ? 1 : 0}${style.fill}`
    const batch = batches.get(key)
    if (batch === undefined) {
      batches.set(key, { style, indexes: [index] })
    } else {
      batch.indexes.push(index)
    }
  }
  const ordered = [...batches].sort(([left], [right]) => (left < right ? -1 : 1))
  for (const [, { style, indexes }] of ordered) {
    ctx.globalAlpha = style.receded ? 0.3 : 1
    ctx.fillStyle = style.fill
    ctx.beginPath()
    for (const index of indexes) {
      const position = positions[index]
      if (position !== undefined) {
        const radius = radiusOf(index)
        ctx.moveTo(position.x + radius, position.y)
        ctx.arc(position.x, position.y, radius, 0, Math.PI * 2)
      }
    }
    ctx.fill()
  }
}

/** One display frame at 60 Hz (ms): a paint that fits in it costs nothing extra. */
const FRAME_MS = 1000 / 60
/** Paint-lengths to wait between paints while settling: painting stays near a fifth. */
const PAINT_SPACING = 4

/**
 * Paces paints while the layout settles. Painting every frame is what blocks
 * the window on a big map: its edges take far longer to draw than a layout
 * step takes to compute. So a settling frame paints only once a few
 * paint-lengths have passed since the last paint. A paint's cost is measured
 * as how late the next frame arrives, since the canvas rasterizes after the
 * frame callback returns. Small maps paint within a frame, cost nothing, and
 * so still paint every frame; once settled, every request paints.
 */
export function createPaintPacer(): (
  frameStart: number,
  settling: boolean,
  paint: () => void,
) => void {
  let lastPaintStart = -Infinity
  let lastPaintCost = 0
  let measuring = false
  return (frameStart, settling, paint) => {
    if (measuring) {
      lastPaintCost = Math.max(0, frameStart - lastPaintStart - FRAME_MS)
      measuring = false
    }
    if (settling && frameStart - lastPaintStart < lastPaintCost * PAINT_SPACING) {
      return
    }
    lastPaintStart = performance.now()
    paint()
    measuring = settling
  }
}
