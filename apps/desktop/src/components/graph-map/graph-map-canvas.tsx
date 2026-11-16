import { useEffect, useRef, type ReactElement } from 'react'
import { isModEvent } from '@meowdown/core'
import { createGraphFrameScheduler } from '@/lib/graph-frame-scheduler'
import { createPaintPacer, paintCircles, paintEdges } from '@/lib/graph-paint'
import {
  ALWAYS_LABELED_HUBS,
  LABEL_MIN_SCREEN_RADIUS,
  createLabelIndex,
  edgeDensityAlpha,
  hubThreshold,
  nodeRadius,
  type LabelRect,
} from '@/lib/graph-readability'
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
  /** Fill color (a tag's hue), or null for the neutral theme fill. */
  color: string | null
  /** The note a local graph centers on: accent fill, name always shown. */
  emphasis?: boolean
}

export interface CanvasEdge {
  source: string
  target: string
  weight: number
}

interface GraphMapCanvasProps {
  nodes: readonly CanvasNode[]
  edges: readonly CanvasEdge[]
  /**
   * Node ids the header search lights up, or null while no search is
   * active. Read at draw time through a ref — a keystroke must repaint,
   * never rebuild the layout.
   */
  matches?: ReadonlySet<string> | null
  /**
   * Open a node's note (a clean click, not the end of a drag). `openInSplit`
   * is the app-wide ⌘/Ctrl-click convention; callers without panes ignore it.
   */
  onOpen: (id: string, openInSplit: boolean) => void
  /**
   * Focus a node's neighborhood (⌥-click; same clean-click rule). The
   * screen owns what focusing means — the canvas only reports the gesture.
   */
  onFocus?: (id: string) => void
  /**
   * `modifier` leaves a plain wheel to the scroll container around the
   * canvas (the note sidebar) and zooms only on a pinch or ⌘/Ctrl-wheel.
   */
  wheelZoom?: 'always' | 'modifier'
  /** Accessible name of the canvas. */
  label?: string
  /**
   * `false` computes the initial layout without drawing it (a few ms of
   * layout per frame) and paints it once settled, instead of painting every
   * frame while it settles. Painting is the
   * expensive half of settling, so a small map that appears alongside a note
   * (the Details panel's local graph) skips the animation; drags still
   * animate.
   */
  animateInitialLayout?: boolean
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
/** A graph this small labels every node it has room for, at any zoom. */
const LABEL_ALL_BELOW = 60
/** Ceiling on the steps an unanimated initial layout runs before its first paint. */
const MAX_SETTLE_STEPS = 600
/** Layout time an unanimated initial layout may spend per frame (ms). */
const SETTLE_FRAME_BUDGET_MS = 6

/** Label type, in screen px: names stay this size however far you zoom. */
const LABEL_FONT_SIZE = 11
const HUB_LABEL_FONT_SIZE = 12
const FONT_FAMILY = 'Inter, system-ui, sans-serif'

/**
 * The Graph view's rendering surface: a raw canvas over the shared force
 * layout. The simulation steps inside a requestAnimationFrame loop that goes
 * idle once the layout settles and every interaction is quiet — hover, drag
 * (nodes pin while held), wheel-zoom about the cursor, and background pans
 * request a frame. Theme changes also request a repaint, without reheating
 * the layout. Hidden documents pause and unmounted canvases cancel their work.
 */
export function GraphMapCanvas({
  nodes,
  edges,
  matches = null,
  onOpen,
  onFocus,
  wheelZoom = 'always',
  label = 'Note graph',
  animateInitialLayout = true,
}: GraphMapCanvasProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen
  const onFocusRef = useRef(onFocus)
  onFocusRef.current = onFocus
  const wheelZoomRef = useRef(wheelZoom)
  wheelZoomRef.current = wheelZoom
  const animateInitialLayoutRef = useRef(animateInitialLayout)
  animateInitialLayoutRef.current = animateInitialLayout
  const matchesRef = useRef<ReadonlySet<string> | null>(matches)
  matchesRef.current = matches
  // Set by the main effect; lets a matches change repaint the settled
  // canvas without rebuilding the layout (the effect keys on nodes/edges).
  const invalidateRef = useRef<() => void>(() => {})
  useEffect(() => {
    invalidateRef.current()
  }, [matches])

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

    const layout: GraphLayout = createGraphLayout(
      nodes.map((node) => node.id),
      nodes.map((node) => nodeRadius(node.inbound)),
    )
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
    /** Cleared once the viewer pans, zooms, or drags — auto-fitting stops there. */
    let autoFit = true
    /**
     * How far out the viewer may zoom. {@link MIN_SCALE} normally, but a
     * graph too big to frame at that scale lowers it to its own fit, so the
     * whole map stays reachable instead of being clipped by the floor.
     */
    let minScale = MIN_SCALE
    const pacePaint = createPaintPacer()
    let settleAtOnce = !animateInitialLayoutRef.current && nodes.length > 0
    let settleSteps = 0
    const frames = createGraphFrameScheduler(() => {
      const frameStart = performance.now()
      if (settleAtOnce) {
        // Settle within a frame budget and paint nothing until done, so the
        // work never grows the frame the note itself is drawn in.
        while (!isSettled(layout) && performance.now() - frameStart < SETTLE_FRAME_BUDGET_MS) {
          stepGraphLayout(layout, layoutEdges)
          settleSteps += 1
          if (settleSteps >= MAX_SETTLE_STEPS) {
            break
          }
        }
        if (!isSettled(layout) && settleSteps < MAX_SETTLE_STEPS) {
          return true
        }
        settleAtOnce = false
        if (autoFit) {
          fitView()
        }
      }
      if (layout.nodes.length > 0 && !isSettled(layout)) {
        // Keep the existing two steps per frame and the same layout policy.
        stepGraphLayout(layout, layoutEdges)
        stepGraphLayout(layout, layoutEdges)
        if (autoFit) {
          fitView()
        }
      }
      const moving = layout.nodes.length > 0 && !isSettled(layout)
      pacePaint(frameStart, moving, draw)
      // Empty graphs never cool down, so they must not keep a loop alive.
      return moving
    })
    invalidateRef.current = frames.request

    const dpr = window.devicePixelRatio || 1
    const resize = (): void => {
      const { clientWidth, clientHeight } = canvas
      surface.width = Math.max(1, Math.round(clientWidth * dpr))
      surface.height = Math.max(1, Math.round(clientHeight * dpr))
      frames.request()
    }
    resize()
    // Fit the starting spiral immediately — before the simulation settles —
    // so the first paint is centered rather than pinned to the top-left.
    fitView()
    const observer = new ResizeObserver(() => {
      resize()
      if (autoFit) {
        fitView()
      }
    })
    observer.observe(surface)
    // Canvas pixels do not inherit CSS changes. A sleeping graph still has
    // to follow the root attributes written by ThemeProvider.
    const themeObserver = new MutationObserver(frames.request)
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme', 'data-accent', 'data-visual-theme'],
    })

    /**
     * Frame the whole graph in the canvas. Called every frame while the
     * layout is still moving and the viewer has not taken over, so a big
     * map — which spends seconds rearranging — stays visible the entire
     * time instead of showing a spiral's worth of dots until it settles.
     */
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
      const scale = Math.min(MAX_SCALE, (width * 0.85) / spanX, (height * 0.85) / spanY, 1.4)
      // A graph wider than MIN_SCALE can show becomes the new zoom floor —
      // clamping the fit up instead would draw it many times oversized, with
      // every node a sub-pixel speck off the edges of the canvas.
      minScale = Math.min(MIN_SCALE, scale)
      viewport.scale = scale
      viewport.offsetX = width / 2 - ((minX + maxX) / 2) * scale
      viewport.offsetY = height / 2 - ((minY + maxY) / 2) * scale
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

    // Structure that does not change while this layout lives: who is a hub,
    // the order labels are offered in (most-linked first), and how loud
    // the resting edges are.
    const hubFrom = hubThreshold(nodes.map((node) => node.inbound))
    const isHub = (index: number): boolean => (nodes[index]?.inbound ?? 0) >= hubFrom
    const labelOrder = [...nodes.keys()].sort(
      (a, b) => (nodes[b]?.inbound ?? 0) - (nodes[a]?.inbound ?? 0),
    )
    const alwaysLabeled = new Set(
      labelOrder.slice(0, ALWAYS_LABELED_HUBS).filter((index) => (nodes[index]?.inbound ?? 0) > 0),
    )
    const edgeAlpha = edgeDensityAlpha(layoutEdges.length)
    const labelAll = nodes.length <= LABEL_ALL_BELOW
    // measureText per label per paint is the label pass's main cost on a
    // big map; names and fonts are fixed for this layout, so cache widths.
    const labelWidths = new Map<string, number>()

    function draw(): void {
      const style = getComputedStyle(surface)
      const colorText = style.getPropertyValue('--text').trim() || '#17181c'
      const colorMuted = style.getPropertyValue('--text-muted').trim() || '#9a9ea7'
      const colorSecondary = style.getPropertyValue('--text-secondary').trim() || '#6b6f76'
      const colorAccent = style.getPropertyValue('--accent').trim() || '#4f46e5'
      const colorBorder = style.getPropertyValue('--border-strong').trim() || 'rgba(18,19,23,0.13)'
      const colorSurface = style.getPropertyValue('--surface').trim() || '#ffffff'

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, surface.clientWidth, surface.clientHeight)
      ctx.translate(viewport.offsetX, viewport.offsetY)
      ctx.scale(viewport.scale, viewport.scale)

      const highlight = hoverIndex ?? drag?.nodeIndex ?? null
      const neighborhood = highlight === null ? null : (neighborSets[highlight] ?? null)
      // The header search: matched nodes light accent, the rest recede.
      // Hover spotlighting stays the stronger signal while it is active.
      const searched = matchesRef.current
      const isMatch = (index: number): boolean => {
        const id = nodes[index]?.id
        return searched !== null && id !== undefined && searched.has(id)
      }

      // Edges first, under the nodes; both passes batch their shapes.
      paintEdges(
        ctx,
        layout.nodes,
        layoutEdges,
        (edge) => {
          if (highlight !== null) {
            return edge.source === highlight || edge.target === highlight ? 'lit' : 'context'
          }
          return searched !== null && !(isMatch(edge.source) && isMatch(edge.target))
            ? 'searchDim'
            : 'base'
        },
        { accent: colorAccent, border: colorBorder },
        viewport.scale,
        edgeAlpha,
      )
      paintCircles(
        ctx,
        layout.nodes,
        (index) => {
          const meta = nodes[index]
          const isHighlight = index === highlight
          const isNeighbor = neighborhood?.has(index) ?? false
          const accent =
            isHighlight || meta?.emphasis === true || (searched !== null && isMatch(index))
          return {
            fill: accent
              ? colorAccent
              : (meta?.color ?? (meta?.isDaily === true ? colorMuted : colorSecondary)),
            receded:
              (highlight !== null && !isHighlight && !isNeighbor) ||
              (searched !== null && !isMatch(index)),
            accent,
            hub: isHub(index),
          }
        },
        (index) => nodeRadius(nodes[index]?.inbound ?? 0),
        { color: colorSurface, scale: viewport.scale },
      )

      // Labels in a second pass, above every circle, in screen space so
      // names keep one size at every zoom. Offered in priority order (the
      // spotlight, its neighbors, search matches, then by inbound links) and
      // placed greedily: a name that would crowd an already placed one is
      // skipped, so a dense map degrades to its most-linked names instead
      // of ink soup. Zoom reveals the rest: a note earns its name once its
      // circle is big enough on screen to tell apart.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.lineJoin = 'round'
      const viewWidth = surface.clientWidth
      const viewHeight = surface.clientHeight
      const labels = createLabelIndex()
      const tried = new Uint8Array(nodes.length)
      const offer = (index: number, forced: boolean): void => {
        if (tried[index] === 1) {
          return
        }
        tried[index] = 1
        const node = layout.nodes[index]
        const meta = nodes[index]
        if (node === undefined || meta === undefined) {
          return
        }
        const isHighlight = index === highlight || meta.emphasis === true
        const isNeighbor = neighborhood?.has(index) ?? false
        const dimmed = highlight !== null && !isHighlight && !isNeighbor
        const searchMiss = searched !== null && !isMatch(index)
        const screenX = node.x * viewport.scale + viewport.offsetX
        const screenY = node.y * viewport.scale + viewport.offsetY
        const screenRadius = nodeRadius(meta.inbound) * viewport.scale
        if (!forced) {
          if (dimmed || searchMiss) {
            return
          }
          if (!labelAll && !alwaysLabeled.has(index) && screenRadius < LABEL_MIN_SCREEN_RADIUS) {
            return
          }
        }
        const strong = isHighlight || isHub(index)
        const fontSize = strong ? HUB_LABEL_FONT_SIZE : LABEL_FONT_SIZE
        const font = `${strong ? 600 : 500} ${fontSize}px ${FONT_FAMILY}`
        const widthKey = `${strong ? 1 : 0}${meta.label}`
        let width = labelWidths.get(widthKey)
        if (width === undefined) {
          ctx.font = font
          width = ctx.measureText(meta.label).width
          labelWidths.set(widthKey, width)
        }
        const height = fontSize * 1.25
        // Off screen: nothing to read, and no reason to block a visible name.
        if (
          screenX + width / 2 < 0 ||
          screenX - width / 2 > viewWidth ||
          screenY + screenRadius + height < 0 ||
          screenY - screenRadius - height > viewHeight
        ) {
          return
        }
        // Below the node first, above it as the fallback, and the other way
        // round when the slot below runs past the bottom edge, so a name near
        // the edge lands where it can be read. A name that fits neither slot
        // is skipped, except the spotlighted note, which always keeps its
        // name (in the slot that stays on the canvas).
        const below: LabelRect = {
          x: screenX - width / 2,
          y: screenY + screenRadius + 3,
          w: width,
          h: height,
        }
        const above: LabelRect = { ...below, y: screenY - screenRadius - 3 - height }
        const slots =
          below.y + below.h > viewHeight && above.y >= 0 ? [above, below] : [below, above]
        let rect = slots.find((slot) => labels.fits(slot))
        if (rect === undefined) {
          if (!isHighlight) {
            return
          }
          rect = slots[0] as LabelRect
        }
        labels.add(rect)
        ctx.font = font
        ctx.globalAlpha = dimmed || searchMiss ? 0.3 : 1
        // A halo in the canvas color lifts the name off the edges and
        // circles beneath it.
        ctx.strokeStyle = colorSurface
        ctx.lineWidth = 3
        ctx.strokeText(meta.label, screenX, rect.y)
        ctx.fillStyle = strong ? colorText : colorSecondary
        ctx.fillText(meta.label, screenX, rect.y)
      }
      if (highlight !== null) {
        offer(highlight, true)
      }
      for (const [index, meta] of nodes.entries()) {
        if (meta.emphasis === true) {
          offer(index, true)
        }
      }
      if (neighborhood !== null) {
        for (const index of labelOrder) {
          if (neighborhood.has(index)) {
            offer(index, true)
          }
        }
      }
      if (searched !== null) {
        for (const index of labelOrder) {
          if (isMatch(index)) {
            offer(index, highlight === null || (neighborhood?.has(index) ?? false))
          }
        }
      }
      for (const index of labelOrder) {
        offer(index, false)
      }
      ctx.globalAlpha = 1
    }

    const handlePointerDown = (event: PointerEvent): void => {
      drag = {
        pointerId: event.pointerId,
        nodeIndex: hitTest(event.clientX, event.clientY),
        startClientX: event.clientX,
        startClientY: event.clientY,
        moved: false,
      }
      // Capture after the drag exists, so a pointerleave the capture may
      // fire reads as "mid-drag" and keeps the spotlight.
      surface.setPointerCapture(event.pointerId)
      if (drag.nodeIndex !== null) {
        const node = layout.nodes[drag.nodeIndex]
        if (node !== undefined) {
          node.pinned = true
        }
      }
      frames.request()
    }

    const handlePointerMove = (event: PointerEvent): void => {
      if (drag === null || event.pointerId !== drag.pointerId) {
        const hit = hitTest(event.clientX, event.clientY)
        if (hit !== hoverIndex) {
          hoverIndex = hit
          surface.style.cursor = hit === null ? 'default' : 'pointer'
          frames.request()
        }
        return
      }
      if (
        Math.abs(event.clientX - drag.startClientX) > CLICK_SLOP ||
        Math.abs(event.clientY - drag.startClientY) > CLICK_SLOP
      ) {
        // Panning or hauling a node hands the viewport to the viewer;
        // re-fitting under their pointer would yank the map away from them.
        // A click that never travelled is not a takeover — it opens a note.
        drag.moved = true
        autoFit = false
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
      frames.request()
    }

    const handlePointerUp = (event: PointerEvent): void => {
      if (drag === null || event.pointerId !== drag.pointerId) {
        return
      }
      const { nodeIndex, moved } = drag
      drag = null
      // A drag released off the canvas: pointerleave was ignored mid-drag,
      // so the spotlight goes now rather than waiting for the pointer to
      // come back.
      const bounds = surface.getBoundingClientRect()
      if (
        hoverIndex !== null &&
        (event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom)
      ) {
        hoverIndex = null
        surface.style.cursor = 'default'
      }
      if (nodeIndex !== null) {
        const node = layout.nodes[nodeIndex]
        if (node !== undefined) {
          node.pinned = false
        }
        if (!moved) {
          const id = nodes[nodeIndex]?.id
          if (id !== undefined) {
            // ⌥ redirects the clean click from opening to focusing; without
            // a focus handler the modifier falls through to open.
            if (event.altKey && onFocusRef.current !== undefined) {
              onFocusRef.current(id)
            } else {
              onOpenRef.current(id, isModEvent(event))
            }
          }
        }
      }
      frames.request()
    }

    // The pointer left the canvas: the spotlight goes with it, or the last
    // hovered note would stay lit (and every other note receded) until the
    // pointer came back.
    const handlePointerLeave = (): void => {
      if (drag === null && hoverIndex !== null) {
        hoverIndex = null
        surface.style.cursor = 'default'
        frames.request()
      }
    }

    const handleWheel = (event: WheelEvent): void => {
      // A trackpad pinch arrives as a ctrlKey wheel.
      if (wheelZoomRef.current === 'modifier' && !event.ctrlKey && !event.metaKey) {
        return
      }
      event.preventDefault()
      const rect = surface.getBoundingClientRect()
      const pointX = event.clientX - rect.left
      const pointY = event.clientY - rect.top
      autoFit = false
      const factor = Math.exp(-event.deltaY * 0.0015)
      const nextScale = Math.min(MAX_SCALE, Math.max(minScale, viewport.scale * factor))
      // Zoom about the cursor: keep the world point under it fixed.
      viewport.offsetX = pointX - ((pointX - viewport.offsetX) / viewport.scale) * nextScale
      viewport.offsetY = pointY - ((pointY - viewport.offsetY) / viewport.scale) * nextScale
      viewport.scale = nextScale
      frames.request()
    }

    surface.addEventListener('pointerdown', handlePointerDown)
    surface.addEventListener('pointermove', handlePointerMove)
    surface.addEventListener('pointerup', handlePointerUp)
    surface.addEventListener('pointercancel', handlePointerUp)
    surface.addEventListener('pointerleave', handlePointerLeave)
    surface.addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      frames.dispose()
      invalidateRef.current = () => {}
      observer.disconnect()
      themeObserver.disconnect()
      surface.removeEventListener('pointerdown', handlePointerDown)
      surface.removeEventListener('pointermove', handlePointerMove)
      surface.removeEventListener('pointerup', handlePointerUp)
      surface.removeEventListener('pointercancel', handlePointerUp)
      surface.removeEventListener('pointerleave', handlePointerLeave)
      surface.removeEventListener('wheel', handleWheel)
    }
  }, [nodes, edges])

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      className="size-full touch-none select-none"
    />
  )
}
