import type { CanvasEdge, CanvasNode } from './graph-map-canvas'

/** What the Graph screen hands the canvas: nodes plus their kept edges. */
export interface GraphView {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

/**
 * How far the local view reaches from the focused note. Two hops keeps the
 * note's working context (its links, and what those link) without pulling
 * half the vault back in.
 */
export const FOCUS_DEPTH = 2

/**
 * The local view (B03a): the focused note's neighborhood, {@link FOCUS_DEPTH}
 * hops out along the view's edges, undirected. A null focus — or one the
 * current view no longer contains (the dailies toggle can remove it, a graph
 * switch invalidates the path) — degrades to the full view rather than an
 * empty map.
 */
export function focusedGraphView(view: GraphView, focusId: string | null): GraphView {
  if (focusId === null || !view.nodes.some((node) => node.id === focusId)) {
    return view
  }
  const neighbors = new Map<string, string[]>()
  const link = (from: string, to: string): void => {
    const list = neighbors.get(from)
    if (list === undefined) {
      neighbors.set(from, [to])
    } else {
      list.push(to)
    }
  }
  for (const edge of view.edges) {
    link(edge.source, edge.target)
    link(edge.target, edge.source)
  }
  const kept = new Set<string>([focusId])
  let frontier = [focusId]
  for (let depth = 0; depth < FOCUS_DEPTH; depth += 1) {
    const next: string[] = []
    for (const id of frontier) {
      for (const neighbor of neighbors.get(id) ?? []) {
        if (!kept.has(neighbor)) {
          kept.add(neighbor)
          next.push(neighbor)
        }
      }
    }
    frontier = next
  }
  return {
    nodes: view.nodes.filter((node) => kept.has(node.id)),
    edges: view.edges.filter((edge) => kept.has(edge.source) && kept.has(edge.target)),
  }
}
