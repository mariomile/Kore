import { z } from 'zod'

/**
 * The `.canvas` file format (JSON Canvas 1.0, https://jsoncanvas.org), as
 * Obsidian writes it: a `nodes` array in z-order and an `edges` array.
 * Kore reads it as is and never writes it, so the file stays Obsidian's.
 *
 * Parsing is lenient: unknown keys are ignored, and a node or edge that
 * lacks what it needs to be drawn (an id, a position, a size, a known type;
 * an edge's two ends) is skipped rather than failing the whole canvas.
 */

export type CanvasSide = 'top' | 'right' | 'bottom' | 'left'

interface CanvasNodeBase {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  /** A preset `"1"`–`"6"` or a hex color, as written; null when unset. */
  readonly color: string | null
}

export type CanvasNode =
  | (CanvasNodeBase & { readonly type: 'text'; readonly text: string })
  | (CanvasNodeBase & {
      readonly type: 'file'
      /** Vault-relative path of the note or attachment. */
      readonly file: string
      /** `#Heading` (or `#^block`) within the file, without the `#`; null for all of it. */
      readonly subpath: string | null
    })
  | (CanvasNodeBase & { readonly type: 'link'; readonly url: string })
  | (CanvasNodeBase & { readonly type: 'group'; readonly label: string | null })

export interface CanvasEdge {
  readonly id: string
  readonly fromNode: string
  readonly toNode: string
  readonly fromSide: CanvasSide | null
  readonly toSide: CanvasSide | null
  /** Whether an arrowhead is drawn at that end (JSON Canvas: none at the start, one at the end). */
  readonly fromArrow: boolean
  readonly toArrow: boolean
  readonly color: string | null
  readonly label: string | null
}

export interface CanvasDocument {
  readonly nodes: readonly CanvasNode[]
  /** Edges whose two ends are both nodes of this canvas. */
  readonly edges: readonly CanvasEdge[]
}

/** A `.canvas` file that is not JSON, or not an object at the top. */
export class CanvasFileError extends Error {}

const looseRecord = z.record(z.string(), z.unknown())

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function side(value: unknown): CanvasSide | null {
  return value === 'top' || value === 'right' || value === 'bottom' || value === 'left'
    ? value
    : null
}

function parseNode(node: unknown): CanvasNode | null {
  const record = looseRecord.safeParse(node)
  if (!record.success) {
    return null
  }
  const data = record.data
  const id = text(data.id)
  const x = finite(data.x)
  const y = finite(data.y)
  const width = finite(data.width)
  const height = finite(data.height)
  if (id === null || x === null || y === null || width === null || height === null) {
    return null
  }
  if (width <= 0 || height <= 0) {
    return null
  }
  const base = { id, x, y, width, height, color: text(data.color) }
  switch (data.type) {
    case 'text':
      return { ...base, type: 'text', text: typeof data.text === 'string' ? data.text : '' }
    case 'file': {
      const file = text(data.file)
      if (file === null) {
        return null
      }
      const subpath = text(data.subpath)?.replace(/^#/, '') ?? null
      return { ...base, type: 'file', file, subpath: subpath === '' ? null : subpath }
    }
    case 'link': {
      const url = text(data.url)
      return url === null ? null : { ...base, type: 'link', url }
    }
    case 'group':
      return { ...base, type: 'group', label: text(data.label) }
    default:
      return null
  }
}

function parseEdge(edge: unknown, nodeIds: ReadonlySet<string>): CanvasEdge | null {
  const record = looseRecord.safeParse(edge)
  if (!record.success) {
    return null
  }
  const data = record.data
  const id = text(data.id)
  const fromNode = text(data.fromNode)
  const toNode = text(data.toNode)
  if (id === null || fromNode === null || toNode === null) {
    return null
  }
  if (!nodeIds.has(fromNode) || !nodeIds.has(toNode)) {
    return null
  }
  return {
    id,
    fromNode,
    toNode,
    fromSide: side(data.fromSide),
    toSide: side(data.toSide),
    fromArrow: data.fromEnd === 'arrow',
    toArrow: data.toEnd !== 'none',
    color: text(data.color),
    label: text(data.label),
  }
}

/**
 * Parse the text of a `.canvas` file.
 *
 * @throws {CanvasFileError} when the text is not a JSON object.
 */
export function parseCanvasFile(source: string): CanvasDocument {
  let document: unknown
  try {
    document = source.trim() === '' ? {} : JSON.parse(source)
  } catch (error) {
    throw new CanvasFileError(error instanceof Error ? error.message : 'not valid JSON')
  }
  const root = looseRecord.safeParse(document)
  if (!root.success) {
    throw new CanvasFileError('a canvas must be a JSON object')
  }
  const nodes = Array.isArray(root.data.nodes)
    ? root.data.nodes.map(parseNode).filter((node): node is CanvasNode => node !== null)
    : []
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges = Array.isArray(root.data.edges)
    ? root.data.edges
        .map((edge) => parseEdge(edge, nodeIds))
        .filter((edge): edge is CanvasEdge => edge !== null)
    : []
  return { nodes, edges }
}

/** Whether a graph-relative path or link target names a `.canvas` file. */
export function isCanvasPath(path: string): boolean {
  return /\.canvas$/i.test(path.split('#')[0]!.trim())
}

/** Display name of a canvas file: its file name without `.canvas`. */
export function canvasDisplayName(path: string): string {
  return (path.split('/').at(-1) ?? path).replace(/\.canvas$/i, '')
}
