import { describe, expect, it } from 'vitest'
import type { CanvasNode } from './graph-map-canvas'
import { focusedGraphView, type GraphView } from './graph-map-focus'

function node(id: string): CanvasNode {
  return { id, label: id, inbound: 0, isDaily: false, color: null }
}

/** A five-note chain: a — b — c — d — e. */
const CHAIN: GraphView = {
  nodes: ['a', 'b', 'c', 'd', 'e'].map(node),
  edges: [
    { source: 'a', target: 'b', weight: 1 },
    { source: 'b', target: 'c', weight: 1 },
    { source: 'c', target: 'd', weight: 1 },
    { source: 'd', target: 'e', weight: 1 },
  ],
}

describe('focusedGraphView', () => {
  it('keeps the focused note and two hops of neighborhood, edges pruned', () => {
    const focused = focusedGraphView(CHAIN, 'a')
    expect(focused.nodes.map((entry) => entry.id)).toEqual(['a', 'b', 'c'])
    expect(focused.edges).toEqual([
      { source: 'a', target: 'b', weight: 1 },
      { source: 'b', target: 'c', weight: 1 },
    ])
  })

  it('walks edges undirected — focusing the chain tail works the same', () => {
    const focused = focusedGraphView(CHAIN, 'e')
    expect(focused.nodes.map((entry) => entry.id)).toEqual(['c', 'd', 'e'])
  })

  it('a mid-chain focus reaches both directions', () => {
    const focused = focusedGraphView(CHAIN, 'c')
    expect(focused.nodes.map((entry) => entry.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('no focus, or a focus the view no longer contains, is the full view', () => {
    expect(focusedGraphView(CHAIN, null)).toBe(CHAIN)
    // The dailies toggle or a graph switch can invalidate the id.
    expect(focusedGraphView(CHAIN, 'gone')).toBe(CHAIN)
  })

  it('an isolated focused note keeps only itself', () => {
    const view: GraphView = { nodes: [node('a'), node('b')], edges: [] }
    const focused = focusedGraphView(view, 'a')
    expect(focused.nodes.map((entry) => entry.id)).toEqual(['a'])
    expect(focused.edges).toEqual([])
  })
})
