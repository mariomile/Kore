import { useEffect, useRef, type ReactElement } from 'react'
import {
  createGraphLayout,
  isSettled,
  reheatGraphLayout,
  stepGraphLayout,
  type GraphLayout,
  type GraphLayoutEdge,
} from '@/lib/graph-layout'

export interface CanvasNode {
  id: string
  label: string
  inbound: number
  isDaily: boolean
}

export interface CanvasEdge {
  source: string
  target: string
  weight: number
}

interface GraphMapCanvasProps {
  nodes: readonly CanvasNode[]
  edges: readonly CanvasEdge[]
  /** Open a node's note (a clean click, not the end of a drag). */
  onOpen: (id: string) => void
}

/** World→screen viewport: `screen = world * scale + offset`. */
interface Viewport {
  offsetX: number
  offsetY: number
  scale: number
}

interface DragState {
  pointerId: number
  /** A node index while dragging a node; null while panning the canvas. */
  nodeIndex: number | null
  startClientX: number
  startClientY: number
  /** True once movement exceeds the click slop — suppresses the click. */
  moved: boolean
}

const MIN_SCALE = 0.15
const MAX_SCALE = 4
const CLICK_SLOP = 4
/** Show a node's label without hover when it has at least this many inbound links. */
const HUB_LABEL_INBOUND = 3
/** …or when the whole graph is small enough to label everything. */
const LABEL_ALL_BELOW = 60

function nodeRadius(inbound: number): number {
  return 4 + Math.min(inbound, 14) * 0.9
}

/**
 * The Graph view's rendering surface: a raw canvas over the shared force
 * layout. The simulation steps inside a requestAnimationFrame loop that goes
 * idle once the layout settles and every interaction is quiet — hover, drag
 * (nodes pin while held), wheel-zoom about the cursor, and background pans
 * only mark the frame dirty. Colors are read from the live design tokens at
 * draw time, so the map follows theme switches without any wiring.
 */
export function GraphMapCanvas({ nodes, edges, onOpen }: GraphMapCanvasProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) {
      return
    }
    const context = canvas.getContext('2d')
    if (context === null) {
      return
    }
    // Rebound non-null: the hoisted function declarations below close over
    // these, and TS drops guard narrowing across function boundaries.
    const surface: HTMLCanvasElement = canvas
    const ctx: CanvasRenderingContext2D = context

    const layout: GraphLayout = createGraphLayout(nodes.map((node) => node.id))
    const indexById = new Map(nodes.map((node, index) => [node.id, index]))
    const layoutEdges: GraphLayoutEdge[] = []
    for (const edge of edges) {
      const source = indexById.get(edge.source)
      const target = indexById.get(edge.target)
      if (source !== undefined && target !== undefined) {
        layoutEdges.push({ source, target, weight: edge.weight })
      }
    }

    const viewport: Viewport = { offsetX: 0, offsetY: 0, scale: 1 }
    let hoverIndex: number | null = null
    let drag: DragState | null = null
    let dirty = true
    let fitted = false
    let disposed = false

    const dpr = window.devicePixelRatio || 1
    const resize = (): void => {
      const { clientWidth, clientHeight } = canvas
      surface.width = Math.max(1, Math.round(clientWidth * dpr))
      surface.height = Math.max(1, Math.round(clientHeight * dpr))
      dirty = true
    }
    resize()
    // Fit the starting spiral immediately — before the simulation settles —
    // so the first paint is centered rather than pinned to the top-left.
    fitView()
    const observer = new ResizeObserver(() => {
      resize()
      if (!fitted) {
        fitView()
      }
    })
    observer.observe(surface)

    /** Center the settled (or settling) graph in the canvas, once. */
    function fitView(): void {
      if (layout.nodes.length === 0) {
        return
      }
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const node of layout.nodes) {
        minX = Math.min(minX, node.x)
        minY = Math.min(minY, node.y)
        maxX = Math.max(maxX, node.x)
        maxY = Math.max(maxY, node.y)
      }
      const width = surface.clientWidth
      const height = surface.clientHeight
      const spanX = Math.max(maxX - minX, 1)
      const spanY = Math.max(maxY - minY, 1)
      const scale = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, Math.min((width * 0.85) / spanX, (height * 0.85) / spanY, 1.4)),
      )
      viewport.scale = scale
      viewport.offsetX = width / 2 - ((minX + maxX) / 2) * scale
      viewport.offsetY = height / 2 - ((minY + maxY) / 2) * scale
      dirty = true
    }

    function toWorld(clientX: number, clientY: number): { x: number; y: number } {
      const rect = surface.getBoundingClientRect()
      return {
        x: (clientX - rect.left - viewport.offsetX) / viewport.scale,
        y: (clientY - rect.top - viewport.offsetY) / viewport.scale,
      }
    }

    function hitTest(clientX: number, clientY: number): number | null {
      const point = toWorld(clientX, clientY)
      // Generous halo so small nodes stay clickable when zoomed out.
      const slop = 6 / viewport.scale
      let best: number | null = null
      let bestDistance = Infinity
      for (const [index, node] of layout.nodes.entries()) {
        const radius = nodeRadius(nodes[index]?.inbound ?? 0) + slop
        const distance = Math.hypot(node.x - point.x, node.y - point.y)
        if (distance <= radius && distance < bestDistance) {
          best = index
          bestDistance = distance
        }
      }
      return best
    }

    const neighborSets: Set<number>[] = nodes.map(() => new Set<number>())
    for (const edge of layoutEdges) {
      neighborSets[edge.source]?.add(edge.target)
      neighborSets[edge.target]?.add(edge.source)
    }

    function draw(): void {
      const style = getComputedStyle(surface)
      const colorText = style.getPropertyValue('--text').trim() || '#17181c'
      const colorMuted = style.getPropertyValue('--text-muted').trim() || '#9a9ea7'
      const colorSecondary = style.getPropertyValue('--text-secondary').trim() || '#6b6f76'
      const colorAccent = style.getPropertyValue('--accent').trim() || '#4f46e5'
      const colorBorder = style.getPropertyValue('--border-strong').trim() || 'rgba(18,19,23,0.13)'

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, surface.clientWidth, surface.clientHeight)
      ctx.translate(viewport.offsetX, viewport.offsetY)
      ctx.scale(viewport.scale, viewport.scale)

      const highlight = hoverIndex ?? drag?.nodeIndex ?? null
      const neighborhood = highlight === null ? null : neighborSets[highlight]

      // Edges first, under the nodes.
      for (const edge of layoutEdges) {
        const source = layout.nodes[edge.source]
        const target = layout.nodes[edge.target]
        if (source === undefined || target === undefined) {
          continue
        }
        const lit = highlight !== null && (edge.source === highlight || edge.target === highlight)
        ctx.strokeStyle = lit ? colorAccent : colorBorder
        ctx.globalAlpha = lit ? 0.9 : highlight === null ? 1 : 0.35
        ctx.lineWidth = (lit ? 1.6 : 1) / viewport.scale
        ctx.beginPath()
        ctx.moveTo(source.x, source.y)
        ctx.lineTo(target.x, target.y)
        ctx.stroke()
      }

      for (const [index, node] of layout.nodes.entries()) {
        const meta = nodes[index]
        if (meta === undefined) {
          continue
        }
        const isHighlight = index === highlight
        const isNeighbor = neighborhood?.has(index) ?? false
        const dimmed = highlight !== null && !isHighlight && !isNeighbor
        ctx.globalAlpha = dimmed ? 0.3 : 1
        ctx.fillStyle = isHighlight ? colorAccent : meta.isDaily ? colorMuted : colorSecondary
        ctx.beginPath()
        ctx.arc(node.x, node.y, nodeRadius(meta.inbound), 0, Math.PI * 2)
        ctx.fill()
      }

      // Labels in a second pass, above every circle, placed greedily in
      // priority order (the spotlight first, then hubs) — a label that would
      // overlap an already-placed one is skipped, so dense clusters degrade
      // to their most important names instead of ink soup.
      const labelAll = nodes.length <= LABEL_ALL_BELOW
      const fontSize = Math.max(10 / viewport.scale, 11)
      ctx.font = `500 ${fontSize}px Inter, system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      const placed: { x: number; y: number; w: number; h: number }[] = []
      const priority = (index: number): number =>
        index === highlight ? 2 : neighborhood?.has(index) ? 1 : 0
      const order = [...layout.nodes.keys()].sort((a, b) => {
        const byPriority = priority(b) - priority(a)
        return byPriority !== 0 ? byPriority : (nodes[b]?.inbound ?? 0) - (nodes[a]?.inbound ?? 0)
      })
      for (const index of order) {
        const node = layout.nodes[index]
        const meta = nodes[index]
        if (node === undefined || meta === undefined) {
          continue
        }
        const isHighlight = index === highlight
        const isNeighbor = neighborhood?.has(index) ?? false
        const dimmed = highlight !== null && !isHighlight && !isNeighbor
        const wanted =
          isHighlight || isNeighbor || ((labelAll || meta.inbound >= HUB_LABEL_INBOUND) && !dimmed)
        if (!wanted) {
          continue
        }
        const width = ctx.measureText(meta.label).width
        const height = fontSize * 1.25
        const radius = nodeRadius(meta.inbound)
        const overlapsPlaced = (rect: { x: number; y: number; w: number; h: number }): boolean =>
          placed.some(
            (other) =>
              rect.x < other.x + other.w &&
              rect.x + rect.w > other.x &&
              rect.y < other.y + other.h &&
              rect.y + rect.h > other.y,
          )
        // Below the node first, above it as the fallback; a name that fits
        // neither is skipped — except the spotlighted note, which always
        // keeps its name.
        let rect = { x: node.x - width / 2, y: node.y + radius + 3, w: width, h: height }
        if (overlapsPlaced(rect)) {
          rect = { ...rect, y: node.y - radius - 3 - height }
          if (overlapsPlaced(rect) && !isHighlight) {
            continue
          }
        }
        placed.push(rect)
        ctx.globalAlpha = dimmed ? 0.3 : 1
        ctx.fillStyle = isHighlight ? colorText : colorSecondary
        ctx.fillText(meta.label, node.x, rect.y)
      }
      ctx.globalAlpha = 1
    }

    function frame(): void {
      if (disposed) {
        return
      }
      if (!isSettled(layout)) {
        // A couple of steps per frame settles quicker without visible jumps.
        stepGraphLayout(layout, layoutEdges)
        stepGraphLayout(layout, layoutEdges)
        dirty = true
        if (isSettled(layout) && !fitted) {
          fitted = true
          fitView()
        }
      }
      if (dirty) {
        dirty = false
        draw()
      }
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)

    const handlePointerDown = (event: PointerEvent): void => {
      surface.setPointerCapture(event.pointerId)
      drag = {
        pointerId: event.pointerId,
        nodeIndex: hitTest(event.clientX, event.clientY),
        startClientX: event.clientX,
        startClientY: event.clientY,
        moved: false,
      }
      if (drag.nodeIndex !== null) {
        const node = layout.nodes[drag.nodeIndex]
        if (node !== undefined) {
          node.pinned = true
        }
      }
      dirty = true
    }

    const handlePointerMove = (event: PointerEvent): void => {
      if (drag === null || event.pointerId !== drag.pointerId) {
        const hit = hitTest(event.clientX, event.clientY)
        if (hit !== hoverIndex) {
          hoverIndex = hit
          surface.style.cursor = hit === null ? 'default' : 'pointer'
          dirty = true
        }
        return
      }
      if (
        Math.abs(event.clientX - drag.startClientX) > CLICK_SLOP ||
        Math.abs(event.clientY - drag.startClientY) > CLICK_SLOP
      ) {
        drag.moved = true
      }
      if (drag.nodeIndex === null) {
        viewport.offsetX += event.movementX
        viewport.offsetY += event.movementY
      } else {
        const node = layout.nodes[drag.nodeIndex]
        if (node !== undefined) {
          const point = toWorld(event.clientX, event.clientY)
          node.x = point.x
          node.y = point.y
          node.vx = 0
          node.vy = 0
          reheatGraphLayout(layout, 0.3)
        }
      }
      dirty = true
    }

    const handlePointerUp = (event: PointerEvent): void => {
      if (drag === null || event.pointerId !== drag.pointerId) {
        return
      }
      const { nodeIndex, moved } = drag
      drag = null
      if (nodeIndex !== null) {
        const node = layout.nodes[nodeIndex]
        if (node !== undefined) {
          node.pinned = false
        }
        if (!moved) {
          const id = nodes[nodeIndex]?.id
          if (id !== undefined) {
            onOpenRef.current(id)
          }
        }
      }
      dirty = true
    }

    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const rect = surface.getBoundingClientRect()
      const pointX = event.clientX - rect.left
      const pointY = event.clientY - rect.top
      const factor = Math.exp(-event.deltaY * 0.0015)
      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, viewport.scale * factor))
      // Zoom about the cursor: keep the world point under it fixed.
      viewport.offsetX = pointX - ((pointX - viewport.offsetX) / viewport.scale) * nextScale
      viewport.offsetY = pointY - ((pointY - viewport.offsetY) / viewport.scale) * nextScale
      viewport.scale = nextScale
      dirty = true
    }

    surface.addEventListener('pointerdown', handlePointerDown)
    surface.addEventListener('pointermove', handlePointerMove)
    surface.addEventListener('pointerup', handlePointerUp)
    surface.addEventListener('pointercancel', handlePointerUp)
    surface.addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      disposed = true
      observer.disconnect()
      surface.removeEventListener('pointerdown', handlePointerDown)
      surface.removeEventListener('pointermove', handlePointerMove)
      surface.removeEventListener('pointerup', handlePointerUp)
      surface.removeEventListener('pointercancel', handlePointerUp)
      surface.removeEventListener('wheel', handleWheel)
    }
  }, [nodes, edges])

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="Note graph"
      className="size-full touch-none select-none"
    />
  )
}
