import { db } from './db'

/**
 * The graph view's data (Plan: docs/roadmap.md "Graph view"): every note as
 * a node and every resolved wiki link as an edge, straight from the index.
 * Templates never appear (the `backlinks` view already excludes them, and
 * the node query filters them too); private notes do — the map is an in-app
 * surface, and private notes are fully visible inside the app. Multi-links
 * between the same pair collapse to one edge; `weight` keeps the count for
 * rendering emphasis.
 */

export interface GraphMapNode {
  path: string
  /** The indexed display title — empty for dailies, whose date is the name. */
  title: string
  dailyDate: string | null
  /** Resolved inbound link count — drives node size. */
  inbound: number
}

export interface GraphMapEdge {
  source: string
  target: string
  /** How many distinct link positions collapse into this edge (≥ 1). */
  weight: number
}

export interface GraphMap {
  nodes: GraphMapNode[]
  edges: GraphMapEdge[]
}

/** Load the whole link map from the active graph's index. */
export async function getGraphMap(): Promise<GraphMap> {
  const [noteRows, edgeRows] = await Promise.all([
    db
      .selectFrom('notes')
      .where('kind', '!=', 'template')
      .select(['path', 'title', 'dailyDate'])
      .orderBy('path')
      .execute(),
    db
      .selectFrom('backlinks')
      .where('sourcePath', 'is not', null)
      .where('targetPath', 'is not', null)
      .whereRef('sourcePath', '!=', 'targetPath')
      .groupBy(['sourcePath', 'targetPath'])
      .select((eb) => ['sourcePath', 'targetPath', eb.fn.countAll<number>().as('weight')])
      .execute(),
  ])

  // Edges whose endpoint rows vanished mid-reindex would strand the layout
  // on unknown ids — keep only edges between known nodes.
  const known = new Set(noteRows.map((row) => row.path))
  const edges: GraphMapEdge[] = []
  const inbound = new Map<string, number>()
  for (const row of edgeRows) {
    const source = row.sourcePath
    const target = row.targetPath
    if (source === null || target === null || !known.has(source) || !known.has(target)) {
      continue
    }
    edges.push({ source, target, weight: Number(row.weight) })
    inbound.set(target, (inbound.get(target) ?? 0) + Number(row.weight))
  }

  return {
    nodes: noteRows.map((row) => ({
      path: row.path,
      title: row.title,
      dailyDate: row.dailyDate,
      inbound: inbound.get(row.path) ?? 0,
    })),
    edges,
  }
}
