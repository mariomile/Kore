/**
 * A small force-directed layout for the Graph view — springs along edges,
 * short-range repulsion between nodes, gentle gravity toward the origin, and
 * a cooling temperature so the map settles instead of jittering forever. No
 * dependency and fully deterministic: nodes start on a golden-angle spiral
 * (not random), so the same graph always settles into the same picture and
 * tests can assert on it. Repulsion runs through a Barnes–Hut quadtree with a
 * cutoff radius, keeping a step ~O(n log n) instead of O(n²) for large graphs.
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
/**
 * The furthest a node may travel in one tick, in layout units. Repulsion is
 * summed over every neighbour inside the cutoff, so a dense cluster — a few
 * thousand notes start packed on the spiral — produces a force large enough
 * to fling nodes past the point where gravity can correct without
 * overshooting. The map then oscillates outward and "settles" (alpha decays
 * regardless) hundreds of thousands of units wide, far past any usable
 * zoom. Capping travel per tick keeps the spread bounded and the picture
 * fittable; it costs nothing on small graphs, which never reach the cap.
 */
const MAX_STEP = 24

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

/**
 * Barnes–Hut opening angle: a quadtree cell narrower than this fraction of its
 * distance acts as one body at its centre of mass. 0 would be the exact sum.
 */
const OPENING_ANGLE = 0.9
/** A cell with at most this many nodes is summed exactly, never split. */
const LEAF_CAPACITY = 8
/** Split depth limit, so coincident nodes cannot recurse without end. */
const MAX_DEPTH = 24

/** One square of the repulsion quadtree, over node indexes. */
interface QuadCell {
  /** Top-left corner and side length. */
  x: number
  y: number
  size: number
  /** Node count and centre of mass — the cell's stand-in body when far. */
  mass: number
  centerX: number
  centerY: number
  /** The four quadrants, or null for a leaf. */
  children: QuadCell[] | null
  /** A leaf's node indexes (empty for a split cell). */
  members: number[]
}

function buildQuadCell(
  nodes: readonly GraphLayoutNode[],
  members: number[],
  x: number,
  y: number,
  size: number,
  depth: number,
): QuadCell {
  let sumX = 0
  let sumY = 0
  for (const index of members) {
    const node = nodes[index] as GraphLayoutNode
    sumX += node.x
    sumY += node.y
  }
  const cell: QuadCell = {
    x,
    y,
    size,
    mass: members.length,
    centerX: sumX / members.length,
    centerY: sumY / members.length,
    children: null,
    members,
  }
  if (members.length <= LEAF_CAPACITY || depth >= MAX_DEPTH) {
    return cell
  }
  const half = size / 2
  const quadrants: number[][] = [[], [], [], []]
  for (const index of members) {
    const node = nodes[index] as GraphLayoutNode
    const quadrant = (node.x < x + half ? 0 : 1) + (node.y < y + half ? 0 : 2)
    ;(quadrants[quadrant] as number[]).push(index)
  }
  cell.children = []
  for (const [quadrant, quadrantMembers] of quadrants.entries()) {
    if (quadrantMembers.length > 0) {
      cell.children.push(
        buildQuadCell(
          nodes,
          quadrantMembers,
          x + (quadrant % 2) * half,
          y + Math.floor(quadrant / 2) * half,
          half,
          depth + 1,
        ),
      )
    }
  }
  cell.members = []
  return cell
}

function buildQuadtree(nodes: readonly GraphLayoutNode[]): QuadCell {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of nodes) {
    minX = Math.min(minX, node.x)
    minY = Math.min(minY, node.y)
    maxX = Math.max(maxX, node.x)
    maxY = Math.max(maxY, node.y)
  }
  // A hair of padding keeps the max-edge nodes strictly inside the square.
  const size = Math.max(maxX - minX, maxY - minY, 1) * 1.000001
  return buildQuadCell(
    nodes,
    nodes.map((_, index) => index),
    minX,
    minY,
    size,
    0,
  )
}

/** Repulsion on `nodes[index]` from one quadtree cell, summed into `force`. */
function accumulateRepulsion(
  nodes: readonly GraphLayoutNode[],
  index: number,
  cell: QuadCell,
  force: { x: number; y: number },
): void {
  const node = nodes[index] as GraphLayoutNode
  // Nothing in a cell whose box lies beyond the cutoff can reach the node.
  const outsideX = Math.max(cell.x - node.x, 0, node.x - (cell.x + cell.size))
  const outsideY = Math.max(cell.y - node.y, 0, node.y - (cell.y + cell.size))
  if (outsideX * outsideX + outsideY * outsideY > REPULSION_CUTOFF * REPULSION_CUTOFF) {
    return
  }
  if (cell.children === null) {
    for (const otherIndex of cell.members) {
      if (otherIndex === index) {
        continue
      }
      const other = nodes[otherIndex] as GraphLayoutNode
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
      const magnitude = REPULSION / squared
      const distance = Math.sqrt(squared)
      force.x += (deltaX / distance) * magnitude
      force.y += (deltaY / distance) * magnitude
    }
    return
  }
  const deltaX = node.x - cell.centerX
  const deltaY = node.y - cell.centerY
  const squared = deltaX * deltaX + deltaY * deltaY
  const containsNode = outsideX === 0 && outsideY === 0
  if (!containsNode && cell.size * cell.size < OPENING_ANGLE * OPENING_ANGLE * squared) {
    if (squared <= REPULSION_CUTOFF * REPULSION_CUTOFF) {
      const magnitude = (REPULSION * cell.mass) / squared
      const distance = Math.sqrt(squared)
      force.x += (deltaX / distance) * magnitude
      force.y += (deltaY / distance) * magnitude
    }
    return
  }
  for (const child of cell.children) {
    accumulateRepulsion(nodes, index, child, force)
  }
}

/** Advance the simulation one tick, mutating positions in place. */
export function stepGraphLayout(layout: GraphLayout, edges: readonly GraphLayoutEdge[]): void {
  const { nodes } = layout
  if (nodes.length === 0 || isSettled(layout)) {
    return
  }
  const alpha = layout.alpha

  // Repulsion through a Barnes–Hut quadtree: near nodes push exactly, far
  // clusters push as one body, and anything past the cutoff not at all. A
  // step stays ~O(n log n) even when thousands of notes crowd one region,
  // where a flat cutoff grid degrades towards O(n²).
  const tree = buildQuadtree(nodes)
  const force = { x: 0, y: 0 }
  for (const [index, node] of nodes.entries()) {
    if (node.pinned) {
      continue
    }
    force.x = -node.x * GRAVITY
    force.y = -node.y * GRAVITY
    accumulateRepulsion(nodes, index, tree, force)
    node.vx = (node.vx + force.x * alpha) * VELOCITY_DAMPING
    node.vy = (node.vy + force.y * alpha) * VELOCITY_DAMPING
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
    const speed = Math.hypot(node.vx, node.vy)
    if (speed > MAX_STEP) {
      const brake = MAX_STEP / speed
      node.vx *= brake
      node.vy *= brake
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
