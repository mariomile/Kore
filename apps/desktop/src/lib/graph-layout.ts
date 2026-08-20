/**
 * A small force-directed layout for the Graph view — springs along edges,
 * short-range repulsion between nodes, gentle gravity toward the origin, and
 * a cooling temperature so the map settles instead of jittering forever. No
 * dependency and fully deterministic: nodes start on a golden-angle spiral
 * (not random), so the same graph always settles into the same picture and
 * tests can assert on it. Repulsion is binned on a coarse grid with a cutoff
 * radius, keeping a step ~O(n·k) instead of O(n²) for large graphs.
 */

export interface GraphLayoutNode {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  /** Pinned while dragged: forces skip it, its position is externally owned. */
  pinned: boolean
}

export interface GraphLayoutEdge {
  /** Indexes into the layout's node array. */
  source: number
  target: number
  /** Collapsed link count — heavier edges pull slightly harder. */
  weight: number
}

export interface GraphLayout {
  nodes: GraphLayoutNode[]
  /** Cooling temperature: 1 hot → ~0 settled (see {@link isSettled}). */
  alpha: number
}

/** Ideal edge length, in layout units. */
const SPRING_LENGTH = 110
const SPRING_STRENGTH = 0.06
/** Inverse-square repulsion scale. */
const REPULSION = 5200
/** Beyond this distance nodes ignore each other (gravity keeps cohesion). */
const REPULSION_CUTOFF = 320
const GRAVITY = 0.015
const VELOCITY_DAMPING = 0.6
const ALPHA_DECAY = 0.985
const SETTLED_ALPHA = 0.02

/** Deterministic starting positions on a golden-angle spiral. */
export function createGraphLayout(ids: readonly string[]): GraphLayout {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))
  return {
    nodes: ids.map((id, index) => {
      const radius = 26 * Math.sqrt(index + 1)
      const angle = index * goldenAngle
      return {
        id,
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
        vx: 0,
        vy: 0,
        pinned: false,
      }
    }),
    alpha: 1,
  }
}

/** Reheat a settled layout (after a drag or a data change) so it re-solves. */
export function reheatGraphLayout(layout: GraphLayout, alpha = 0.5): void {
  layout.alpha = Math.max(layout.alpha, alpha)
}

export function isSettled(layout: GraphLayout): boolean {
  return layout.alpha < SETTLED_ALPHA
}

/** Advance the simulation one tick, mutating positions in place. */
export function stepGraphLayout(layout: GraphLayout, edges: readonly GraphLayoutEdge[]): void {
  const { nodes } = layout
  if (nodes.length === 0 || isSettled(layout)) {
    return
  }
  const alpha = layout.alpha

  // Bin nodes on a coarse grid; only same-or-neighboring cells repel, which
  // bounds each node's interactions to its local crowd.
  const cellSize = REPULSION_CUTOFF
  const cells = new Map<string, number[]>()
  for (const [index, node] of nodes.entries()) {
    const key = `${Math.floor(node.x / cellSize)}:${Math.floor(node.y / cellSize)}`
    const bucket = cells.get(key)
    if (bucket === undefined) {
      cells.set(key, [index])
    } else {
      bucket.push(index)
    }
  }

  for (const [index, node] of nodes.entries()) {
    if (node.pinned) {
      continue
    }
    let fx = -node.x * GRAVITY
    let fy = -node.y * GRAVITY

    const cellX = Math.floor(node.x / cellSize)
    const cellY = Math.floor(node.y / cellSize)
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const bucket = cells.get(`${cellX + dx}:${cellY + dy}`)
        if (bucket === undefined) {
          continue
        }
        for (const otherIndex of bucket) {
          if (otherIndex === index) {
            continue
          }
          const other = nodes[otherIndex]
          if (other === undefined) {
            continue
          }
          let deltaX = node.x - other.x
          let deltaY = node.y - other.y
          let squared = deltaX * deltaX + deltaY * deltaY
          if (squared === 0) {
            // Coincident nodes (spiral start can't produce them, but drags
            // can): nudge apart deterministically by index parity.
            deltaX = index % 2 === 0 ? 0.5 : -0.5
            deltaY = 0.5
            squared = 0.5
          }
          if (squared > REPULSION_CUTOFF * REPULSION_CUTOFF) {
            continue
          }
          const force = REPULSION / squared
          const distance = Math.sqrt(squared)
          fx += (deltaX / distance) * force
          fy += (deltaY / distance) * force
        }
      }
    }

    node.vx = (node.vx + fx * alpha) * VELOCITY_DAMPING
    node.vy = (node.vy + fy * alpha) * VELOCITY_DAMPING
  }

  for (const edge of edges) {
    const source = nodes[edge.source]
    const target = nodes[edge.target]
    if (source === undefined || target === undefined) {
      continue
    }
    const deltaX = target.x - source.x
    const deltaY = target.y - source.y
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY) || 1
    // Heavier edges pull a bit harder, capped so a hub link can't slingshot.
    const emphasis = 1 + Math.min(edge.weight - 1, 3) * 0.25
    const pull = (distance - SPRING_LENGTH) * SPRING_STRENGTH * emphasis * alpha
    const unitX = (deltaX / distance) * pull
    const unitY = (deltaY / distance) * pull
    if (!source.pinned) {
      source.vx += unitX
      source.vy += unitY
    }
    if (!target.pinned) {
      target.vx -= unitX
      target.vy -= unitY
    }
  }

  for (const node of nodes) {
    if (node.pinned) {
      continue
    }
    node.x += node.vx
    node.y += node.vy
  }

  layout.alpha *= ALPHA_DECAY
}

/** Run the simulation to rest synchronously (tests; small graphs). */
export function settleGraphLayout(
  layout: GraphLayout,
  edges: readonly GraphLayoutEdge[],
  maxSteps = 600,
): void {
  for (let step = 0; step < maxSteps && !isSettled(layout); step += 1) {
    stepGraphLayout(layout, edges)
  }
}
