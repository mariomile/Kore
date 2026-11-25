import { CanvasFileError, type CanvasNode } from './canvas-file'
import type { CanvasRect } from './geometry'

/**
 * The light edits Kore makes to a `.canvas` file: move or resize a node,
 * change a text card's text, add a note or text card, remove nodes.
 *
 * Edits apply to the file's own JSON, not to the parsed document, so every
 * key Kore doesn't know (a plugin's node type, Obsidian's future fields)
 * survives the write and the file stays Obsidian's.
 */
export type CanvasEdit =
  | { readonly kind: 'place'; readonly id: string; readonly rect: CanvasRect }
  | { readonly kind: 'text'; readonly id: string; readonly text: string }
  | { readonly kind: 'remove'; readonly ids: readonly string[] }
  | {
      readonly kind: 'add'
      readonly id: string
      readonly rect: CanvasRect
      readonly card:
        | { readonly type: 'file'; readonly file: string }
        | { readonly type: 'text'; readonly text: string }
    }

/** Obsidian's canvas grid: positions and sizes snap to it. */
export const CANVAS_GRID = 20

/** The smallest card a resize leaves, in canvas units. */
export const CANVAS_MIN_SIZE = 60

/** A note card's default size (as `kore canvas` lays them out) and a text card's. */
export const CANVAS_NOTE_SIZE = { width: 400, height: 280 } as const
export const CANVAS_TEXT_SIZE = { width: 300, height: 160 } as const

/** `value` on the canvas grid. */
export function snapToCanvasGrid(value: number): number {
  return Math.round(value / CANVAS_GRID) * CANVAS_GRID
}

/** A fresh node id: 16 hex digits, the length Obsidian writes. */
export function newCanvasNodeId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function overlaps(a: CanvasRect, b: CanvasRect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/**
 * Where a new card of `size` goes: centred on `center`, on the grid, then
 * stepped down until it covers no card (a group may sit behind it).
 */
export function canvasFreeSpot(
  center: { readonly x: number; readonly y: number },
  size: { readonly width: number; readonly height: number },
  nodes: readonly CanvasNode[],
): CanvasRect {
  const cards = nodes.filter((node) => node.type !== 'group')
  let rect: CanvasRect = {
    x: snapToCanvasGrid(center.x - size.width / 2),
    y: snapToCanvasGrid(center.y - size.height / 2),
    ...size,
  }
  for (let step = 0; step < 100 && cards.some((card) => overlaps(card, rect)); step += 1) {
    rect = { ...rect, y: rect.y + CANVAS_GRID * 2 }
  }
  return rect
}

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function objects(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isObject) : []
}

function rectKeys(rect: CanvasRect): Pick<JsonObject, 'x' | 'y' | 'width' | 'height'> {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  }
}

/**
 * The text of `source` with `edits` applied, in order. An edit naming a node
 * the file no longer has does nothing (someone else removed it meanwhile);
 * removing a node removes the edges that end on it.
 *
 * @throws {CanvasFileError} when `source` is not a JSON object.
 */
export function applyCanvasEdits(source: string, edits: readonly CanvasEdit[]): string {
  let root: unknown
  try {
    root = source.trim() === '' ? {} : JSON.parse(source)
  } catch (error) {
    throw new CanvasFileError(error instanceof Error ? error.message : 'not valid JSON')
  }
  if (!isObject(root)) {
    throw new CanvasFileError('a canvas must be a JSON object')
  }
  let nodes = Array.isArray(root.nodes) ? (root.nodes as unknown[]) : []
  let edges = Array.isArray(root.edges) ? (root.edges as unknown[]) : []
  const byId = (id: string): JsonObject | undefined => objects(nodes).find((node) => node.id === id)

  for (const edit of edits) {
    switch (edit.kind) {
      case 'place': {
        const node = byId(edit.id)
        if (node !== undefined) {
          Object.assign(node, rectKeys(edit.rect))
        }
        break
      }
      case 'text': {
        const node = byId(edit.id)
        if (node?.type === 'text') {
          node.text = edit.text
        }
        break
      }
      case 'remove': {
        const removed = new Set(edit.ids)
        nodes = nodes.filter((node) => !isObject(node) || !removed.has(node.id as string))
        edges = edges.filter(
          (edge) =>
            !isObject(edge) ||
            (!removed.has(edge.fromNode as string) && !removed.has(edge.toNode as string)),
        )
        break
      }
      case 'add':
        nodes = [...nodes, { id: edit.id, ...edit.card, ...rectKeys(edit.rect) }]
        break
    }
  }
  // Obsidian writes tab-indented JSON; matching it keeps a sync diff small.
  return `${JSON.stringify({ ...root, nodes, edges }, null, '\t')}\n`
}
