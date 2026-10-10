import { describe, expect, it } from 'vitest'
import { CanvasFileError, parseCanvasFile } from './canvas-file'
import { canvasBounds, layoutCanvasEdges } from './geometry'

const CANVAS = JSON.stringify({
  nodes: [
    {
      id: 'g',
      type: 'group',
      x: -50,
      y: -50,
      width: 700,
      height: 400,
      label: 'Captoo',
      color: '4',
    },
    { id: 'a', type: 'text', x: 0, y: 0, width: 200, height: 100, text: '# Idea\n- **bold**' },
    {
      id: 'b',
      type: 'file',
      x: 400,
      y: 0,
      width: 200,
      height: 100,
      file: 'Notes/Kore.md',
      subpath: '#Roadmap',
    },
    { id: 'c', type: 'link', x: 0, y: 200, width: 200, height: 100, url: 'https://jsoncanvas.org' },
    { id: 'bad-size', type: 'text', x: 0, y: 0, width: 0, height: 10, text: 'x' },
    { id: 'plugin', type: 'mindmap', x: 0, y: 0, width: 10, height: 10 },
  ],
  edges: [
    { id: 'e1', fromNode: 'a', fromSide: 'right', toNode: 'b', toSide: 'left', label: 'feeds' },
    { id: 'e2', fromNode: 'a', toNode: 'c', fromEnd: 'arrow', toEnd: 'none', color: '#ff0000' },
    { id: 'dangling', fromNode: 'a', toNode: 'missing' },
  ],
})

describe('parseCanvasFile', () => {
  it('keeps every drawable node and edge, skipping the rest', () => {
    const canvas = parseCanvasFile(CANVAS)
    expect(canvas.nodes.map((node) => node.id)).toEqual(['g', 'a', 'b', 'c'])
    expect(canvas.nodes[2]).toMatchObject({
      type: 'file',
      file: 'Notes/Kore.md',
      subpath: 'Roadmap',
    })
    expect(canvas.nodes[0]).toMatchObject({ type: 'group', label: 'Captoo', color: '4' })
    expect(canvas.edges.map((edge) => edge.id)).toEqual(['e1', 'e2'])
    expect(canvas.edges[0]).toMatchObject({ fromArrow: false, toArrow: true, label: 'feeds' })
    expect(canvas.edges[1]).toMatchObject({ fromArrow: true, toArrow: false, color: '#ff0000' })
  })

  it('reads an empty file as an empty canvas and rejects non-JSON', () => {
    expect(parseCanvasFile('')).toEqual({ nodes: [], edges: [] })
    expect(() => parseCanvasFile('nodes: []')).toThrow(CanvasFileError)
    expect(() => parseCanvasFile('[]')).toThrow(CanvasFileError)
  })
})

describe('canvas geometry', () => {
  it('bounds every node and attaches edges to the sides they name or face', () => {
    const canvas = parseCanvasFile(CANVAS)
    expect(canvasBounds(canvas.nodes)).toEqual({ x: -50, y: -50, width: 700, height: 400 })
    const [named, facing] = layoutCanvasEdges(canvas)
    // a's right side (200, 50) to b's left side (400, 50), one arrow into b.
    expect(named!.path).toMatch(/^M 200 50 C .* 400 50$/)
    expect(named!.arrows).toEqual(['400,50 388,44 388,56'])
    expect(named!.labelAt).toEqual({ x: 300, y: 50 })
    // c sits below a, so the edge runs a's bottom (100, 100) to c's top (100, 200).
    expect(facing!.path).toMatch(/^M 100 100 C .* 100 200$/)
    expect(facing!.arrows).toHaveLength(1)
  })
})
