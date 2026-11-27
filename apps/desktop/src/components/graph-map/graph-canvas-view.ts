import {
  displayNoteTitle,
  foldTag,
  noteFileStem,
  type GraphMap,
  type GraphMapNode,
} from '@kore/core'
import { tagColorCss } from '@/lib/graph-colors'
import type { CanvasEdge, CanvasNode } from './graph-map-canvas'

/** The label a node renders: title, else the daily date, else the file stem. */
function nodeLabel(node: GraphMapNode): string {
  if (node.dailyDate !== null) {
    return node.dailyDate
  }
  return displayNoteTitle(node.title === '' ? noteFileStem(node.path) : node.title)
}

export interface GraphCanvasView {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

/**
 * The index's link map as the canvas draws it. Dailies are left out unless
 * asked for (they mostly orbit as unlinked satellites), except `keep`, a
 * focused note that must stay even when it is a day.
 */
export function graphCanvasView(
  data: GraphMap,
  { showDailies, keep = null }: { showDailies: boolean; keep?: string | null },
): GraphCanvasView {
  const nodes: CanvasNode[] = data.nodes
    .filter((node) => showDailies || node.dailyDate === null || node.path === keep)
    .map((node) => ({
      id: node.path,
      label: nodeLabel(node),
      inbound: node.inbound,
      isDaily: node.dailyDate !== null,
      // One hue per first tag: clusters that share a topic read as one
      // color. Untagged notes keep the neutral fill.
      color: node.tag === null ? null : tagColorCss(foldTag(node.tag)),
    }))
  const kept = new Set(nodes.map((node) => node.id))
  const edges = data.edges
    .filter((edge) => kept.has(edge.source) && kept.has(edge.target))
    .map((edge) => ({ source: edge.source, target: edge.target, weight: edge.weight }))
  return { nodes, edges }
}
