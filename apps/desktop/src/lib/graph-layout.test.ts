import { describe, expect, it } from 'vitest'
import {
  createGraphLayout,
  isSettled,
  reheatGraphLayout,
  settleGraphLayout,
  stepGraphLayout,
} from './graph-layout'

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

describe('graph layout', () => {
  it('settles the linked pair near the spring length, everything finite', () => {
    const layout = createGraphLayout(['a', 'b', 'c', 'd'])
    const edges = [{ source: 0, target: 1, weight: 1 }]
    settleGraphLayout(layout, edges)

    expect(isSettled(layout)).toBe(true)
    for (const node of layout.nodes) {
      expect(Number.isFinite(node.x)).toBe(true)
      expect(Number.isFinite(node.y)).toBe(true)
    }
    // The spring holds the linked pair near its ideal length; repulsion keeps
    // every pair apart (no two nodes collapse onto each other).
    const [a, b] = layout.nodes
    expect(distance(a!, b!)).toBeGreaterThan(60)
    expect(distance(a!, b!)).toBeLessThan(180)
    for (const [i, first] of layout.nodes.entries()) {
      for (const second of layout.nodes.slice(i + 1)) {
        expect(distance(first, second)).toBeGreaterThan(20)
      }
    }
  })

  it('is deterministic: the same graph settles into the same picture', () => {
    const edges = [
      { source: 0, target: 1, weight: 2 },
      { source: 1, target: 2, weight: 1 },
    ]
    const first = createGraphLayout(['a', 'b', 'c'])
    const second = createGraphLayout(['a', 'b', 'c'])
    settleGraphLayout(first, edges)
    settleGraphLayout(second, edges)
    expect(first.nodes).toEqual(second.nodes)
  })

  it('never moves a pinned node and reheats for re-solving', () => {
    const layout = createGraphLayout(['a', 'b'])
    const pinned = layout.nodes[0]!
    pinned.pinned = true
    const { x, y } = pinned
    settleGraphLayout(layout, [{ source: 0, target: 1, weight: 1 }])
    expect(pinned.x).toBe(x)
    expect(pinned.y).toBe(y)

    expect(isSettled(layout)).toBe(true)
    reheatGraphLayout(layout)
    expect(isSettled(layout)).toBe(false)
  })

  it('steps an empty layout without dividing by zero', () => {
    const layout = createGraphLayout([])
    stepGraphLayout(layout, [])
    expect(layout.nodes).toEqual([])
  })
})
