import { describe, expect, it } from 'vitest'
import { parseCanvasFile } from './canvas-file'
import { applyCanvasEdits, canvasFreeSpot, newCanvasNodeId, snapToCanvasGrid } from './edit'
import { nodesInsideGroup } from './geometry'

const SOURCE = JSON.stringify({
  nodes: [
    { id: 'g', type: 'group', x: 0, y: 0, width: 600, height: 400, label: 'Studio' },
    {
      id: 'a',
      type: 'text',
      x: 40,
      y: 40,
      width: 200,
      height: 100,
      text: 'Idea',
      styleAttributes: {},
    },
    { id: 'b', type: 'file', x: 300, y: 40, width: 200, height: 100, file: 'Kore.md' },
    { id: 'p', type: 'mindmap', x: 900, y: 0, width: 10, height: 10, branch: 'left' },
  ],
  edges: [
    { id: 'e1', fromNode: 'a', toNode: 'b', label: 'drives' },
    { id: 'e2', fromNode: 'b', toNode: 'p' },
  ],
  metadata: { version: '1.0-1.0' },
})

interface RawCanvas {
  nodes: Record<string, unknown>[]
  edges: unknown[]
  metadata?: unknown
}

function raw(source: string): RawCanvas {
  return JSON.parse(source) as RawCanvas
}

describe('applyCanvasEdits', () => {
  it('moves and resizes a node, rounding to whole units, and keeps every other key', () => {
    const out = raw(
      applyCanvasEdits(SOURCE, [
        { kind: 'place', id: 'a', rect: { x: 60.4, y: 80, width: 240, height: 119.6 } },
      ]),
    )
    expect(out.nodes[1]).toEqual({
      id: 'a',
      type: 'text',
      x: 60,
      y: 80,
      width: 240,
      height: 120,
      text: 'Idea',
      styleAttributes: {},
    })
    // A plugin's node and the file's own metadata survive untouched.
    expect(out.nodes[3]).toEqual({
      id: 'p',
      type: 'mindmap',
      x: 900,
      y: 0,
      width: 10,
      height: 10,
      branch: 'left',
    })
    expect(out.metadata).toEqual({ version: '1.0-1.0' })
  })

  it('removes nodes with the edges that end on them', () => {
    const out = raw(applyCanvasEdits(SOURCE, [{ kind: 'remove', ids: ['b'] }]))
    expect(out.nodes.map((node) => node.id)).toEqual(['g', 'a', 'p'])
    expect(out.edges).toEqual([])
  })

  it('adds note and text cards on top, and edits only a text card’s text', () => {
    const doc = parseCanvasFile(
      applyCanvasEdits(SOURCE, [
        {
          kind: 'add',
          id: 'n',
          rect: { x: 0, y: 500, width: 400, height: 280 },
          card: { type: 'file', file: 'Brief.md' },
        },
        {
          kind: 'add',
          id: 't',
          rect: { x: 440, y: 500, width: 300, height: 160 },
          card: { type: 'text', text: '' },
        },
        { kind: 'text', id: 't', text: '## Open questions' },
        { kind: 'text', id: 'b', text: 'not a text card' },
      ]),
    )
    expect(doc.nodes.at(-2)).toMatchObject({
      id: 'n',
      type: 'file',
      file: 'Brief.md',
      x: 0,
      y: 500,
    })
    expect(doc.nodes.at(-1)).toMatchObject({ id: 't', type: 'text', text: '## Open questions' })
    expect(doc.nodes.find((node) => node.id === 'b')).not.toHaveProperty('text')
  })

  it('ignores an edit whose node is gone, and writes tab-indented JSON like Obsidian', () => {
    const out = applyCanvasEdits(SOURCE, [
      { kind: 'place', id: 'missing', rect: { x: 0, y: 0, width: 10, height: 10 } },
    ])
    expect(JSON.parse(out)).toEqual(JSON.parse(SOURCE))
    expect(out).toContain('\n\t"nodes": [')
    expect(out.endsWith('}\n')).toBe(true)
  })

  it('starts an empty file as a canvas', () => {
    const out = raw(
      applyCanvasEdits('', [
        {
          kind: 'add',
          id: 'n',
          rect: { x: 0, y: 0, width: 400, height: 280 },
          card: { type: 'text', text: 'Hi' },
        },
      ]),
    )
    expect(out).toEqual({
      nodes: [{ id: 'n', type: 'text', text: 'Hi', x: 0, y: 0, width: 400, height: 280 }],
      edges: [],
    })
  })
})

describe('canvas editing helpers', () => {
  it('finds the nodes wholly inside a group', () => {
    const doc = parseCanvasFile(SOURCE)
    const group = doc.nodes.find((node) => node.id === 'g')!
    expect(nodesInsideGroup(group, doc.nodes)).toEqual(['a', 'b'])
  })

  it('snaps to the 20-unit grid and mints 16-hex ids', () => {
    expect(snapToCanvasGrid(29)).toBe(20)
    expect(snapToCanvasGrid(-31)).toBe(-40)
    expect(newCanvasNodeId()).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('canvasFreeSpot', () => {
  it('centres a new card on the grid and steps it below the cards it would cover', () => {
    const doc = parseCanvasFile(SOURCE)
    expect(canvasFreeSpot({ x: 2000, y: 2000 }, { width: 200, height: 100 }, doc.nodes)).toEqual({
      x: 1900,
      y: 1960,
      width: 200,
      height: 100,
    })
    // Over card `a` (40..240 × 40..140): it lands just below, still inside the group.
    const spot = canvasFreeSpot({ x: 140, y: 90 }, { width: 200, height: 100 }, doc.nodes)
    expect(spot).toMatchObject({ x: 40, y: 160 })
  })
})
