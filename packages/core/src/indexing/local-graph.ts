import type { Database } from '@reflect/db'
import type { Expression, ExpressionBuilder, SqlBool } from 'kysely'
import { db } from './db'

/**
 * One note's neighborhood for the note sidebar's local graph: the note, the
 * notes it links to and the notes linking to it (frontmatter `up:` and
 * `related:` links included — the index stores them as wiki links), and at
 * depth 2 the notes around those. Resolution is the `backlinks` view's, so a
 * neighbor appears exactly when its link would navigate. Bounded on purpose:
 * a hub (a Home note, a daily with 200 links) keeps its strongest neighbors
 * and reports the rest as {@link LocalGraph.hidden}, so the sidebar never
 * lays out hundreds of nodes.
 */

/** How far the local graph reaches from the open note. */
export type LocalGraphDepth = 1 | 2

export interface LocalGraphOptions {
  readonly depth: LocalGraphDepth
  /** Add the shown notes' tags as nodes (each linked to its notes). */
  readonly tags: boolean
}

export interface LocalGraphNode {
  /** The note's graph-relative path, or `#tag` for a tag node. */
  readonly id: string
  readonly kind: 'note' | 'tag'
  /** Display title; empty for dailies (the date is the name) and tag nodes. */
  readonly title: string
  readonly dailyDate: string | null
  /** Hops from the open note: 0 for the note itself; tags count as 1. */
  readonly depth: 0 | 1 | 2
  /** The note's first tag (folded-key order), or the tag itself — drives color. */
  readonly tag: string | null
}

export interface LocalGraphEdge {
  readonly source: string
  readonly target: string
  /** Distinct link positions collapsed into this edge (≥ 1). */
  readonly weight: number
}

export interface LocalGraph {
  readonly nodes: LocalGraphNode[]
  readonly edges: LocalGraphEdge[]
  /** Neighbors left out by the caps (direct links first, then depth 2). */
  readonly hidden: number
}

/** Direct neighbors kept around a hub, strongest first. */
export const LOCAL_GRAPH_DIRECT_LIMIT = 30
/** Every note node at depth 2, the open note and its direct neighbors included. */
export const LOCAL_GRAPH_NOTE_LIMIT = 60
/** Tag nodes kept when tags are on, most shared first. */
export const LOCAL_GRAPH_TAG_LIMIT = 12

interface NoteMeta {
  readonly path: string
  readonly title: string
  readonly dailyDate: string | null
}

interface Candidate extends NoteMeta {
  /** Link positions to the anchor set (direct) or distinct anchors (depth 2). */
  score: number
  weight: number
}

/** Strongest first; ideas before dailies on a tie (they mostly orbit as logs); then by path. */
function byStrength(left: Candidate, right: Candidate): number {
  return (
    right.score - left.score ||
    right.weight - left.weight ||
    Number(left.dailyDate !== null) - Number(right.dailyDate !== null) ||
    left.path.localeCompare(right.path)
  )
}

async function directNeighbors(path: string): Promise<Candidate[]> {
  const [outgoing, incoming] = await Promise.all([
    db
      .selectFrom('backlinks')
      .innerJoin('notes', 'notes.path', 'backlinks.targetPath')
      .where('backlinks.sourcePath', '=', path)
      .where('notes.kind', '!=', 'template')
      .where('notes.path', '!=', path)
      .groupBy('notes.path')
      .select((eb) => [
        'notes.path as path',
        'notes.title as title',
        'notes.dailyDate as dailyDate',
        eb.fn.countAll<number>().as('weight'),
      ])
      .execute(),
    db
      .selectFrom('backlinks')
      .innerJoin('notes', 'notes.path', 'backlinks.sourcePath')
      .where('backlinks.targetPath', '=', path)
      .where('notes.path', '!=', path)
      .groupBy('notes.path')
      .select((eb) => [
        'notes.path as path',
        'notes.title as title',
        'notes.dailyDate as dailyDate',
        eb.fn.countAll<number>().as('weight'),
      ])
      .execute(),
  ])
  const byPath = new Map<string, Candidate>()
  for (const row of [...outgoing, ...incoming]) {
    const weight = Number(row.weight)
    const known = byPath.get(row.path)
    if (known === undefined) {
      byPath.set(row.path, { ...row, score: weight, weight })
    } else {
      known.score += weight
      known.weight += weight
    }
  }
  return [...byPath.values()]
}

async function collapsedLinks(
  filter: (eb: ExpressionBuilder<Database, 'backlinks'>) => Expression<SqlBool>,
): Promise<LocalGraphEdge[]> {
  const rows = await db
    .selectFrom('backlinks')
    .where(filter)
    .where('sourcePath', 'is not', null)
    .where('targetPath', 'is not', null)
    .whereRef('sourcePath', '!=', 'targetPath')
    .groupBy(['sourcePath', 'targetPath'])
    .select((eb) => ['sourcePath', 'targetPath', eb.fn.countAll<number>().as('weight')])
    .execute()
  return rows.flatMap((row) =>
    row.sourcePath === null || row.targetPath === null
      ? []
      : [{ source: row.sourcePath, target: row.targetPath, weight: Number(row.weight) }],
  )
}

/**
 * Resolved links collapsed per (source, target): every link touching
 * `anchors`, or with `within` only the links between two of them. The
 * touching case runs as two queries (leaving, then arriving from outside)
 * because an `OR` across the view's two columns scans the whole link table.
 */
async function linksAround(anchors: readonly string[], within: boolean): Promise<LocalGraphEdge[]> {
  if (within) {
    return await collapsedLinks((eb) =>
      eb.and([eb('sourcePath', 'in', anchors), eb('targetPath', 'in', anchors)]),
    )
  }
  const [leaving, arriving] = await Promise.all([
    collapsedLinks((eb) => eb('sourcePath', 'in', anchors)),
    collapsedLinks((eb) =>
      eb.and([eb('targetPath', 'in', anchors), eb('sourcePath', 'not in', anchors)]),
    ),
  ])
  return [...leaving, ...arriving]
}

/**
 * Build the local graph around `path`. Two to four indexed queries whatever
 * the vault size: the direct links (both directions), the links around the
 * kept neighbors, and — for depth 2 or tags — the extra notes' rows and the
 * shown notes' tags.
 */
export async function getLocalGraph(path: string, options: LocalGraphOptions): Promise<LocalGraph> {
  const center = await db
    .selectFrom('notes')
    .where('path', '=', path)
    .select(['path', 'title', 'dailyDate'])
    .executeTakeFirst()
  if (center === undefined) {
    return { nodes: [], edges: [], hidden: 0 }
  }

  const direct = (await directNeighbors(path)).sort(byStrength)
  const kept = direct.slice(0, LOCAL_GRAPH_DIRECT_LIMIT)
  let hidden = direct.length - kept.length
  const dropped = new Set(direct.slice(LOCAL_GRAPH_DIRECT_LIMIT).map((note) => note.path))
  const depthOf = new Map<string, 0 | 1 | 2>([[path, 0]])
  const meta = new Map<string, NoteMeta>([[path, center]])
  for (const note of kept) {
    depthOf.set(note.path, 1)
    meta.set(note.path, note)
  }

  // Depth 1 only needs the links among the kept notes; depth 2 needs every
  // link leaving them to find the second ring.
  const around =
    kept.length === 0
      ? []
      : await linksAround([path, ...kept.map((note) => note.path)], options.depth === 1)

  if (options.depth === 2 && kept.length > 0) {
    // Rank the second ring by how many direct neighbors reach it: a note
    // three of them cite belongs to this context more than one a hub cites.
    const reach = new Map<string, { anchors: Set<string>; weight: number }>()
    for (const edge of around) {
      const sourceKept = depthOf.has(edge.source)
      const targetKept = depthOf.has(edge.target)
      if (sourceKept === targetKept) {
        continue
      }
      const outer = sourceKept ? edge.target : edge.source
      const anchor = sourceKept ? edge.source : edge.target
      // A direct neighbor the cap dropped is already in `hidden`; letting it
      // back in through the center would show it a ring too far and count
      // it twice.
      if (dropped.has(outer)) {
        continue
      }
      const entry = reach.get(outer) ?? { anchors: new Set<string>(), weight: 0 }
      entry.anchors.add(anchor)
      entry.weight += edge.weight
      reach.set(outer, entry)
    }
    const outerPaths = [...reach.keys()]
    const outerRows =
      outerPaths.length === 0
        ? []
        : await db
            .selectFrom('notes')
            .where('path', 'in', outerPaths)
            .where('kind', '!=', 'template')
            .select(['path', 'title', 'dailyDate'])
            .execute()
    const candidates = outerRows
      .map((row): Candidate => {
        const entry = reach.get(row.path)
        return { ...row, score: entry?.anchors.size ?? 0, weight: entry?.weight ?? 0 }
      })
      .sort(byStrength)
    const room = Math.max(0, LOCAL_GRAPH_NOTE_LIMIT - depthOf.size)
    for (const note of candidates.slice(0, room)) {
      depthOf.set(note.path, 2)
      meta.set(note.path, note)
    }
    hidden += Math.max(0, candidates.length - room)
  }

  const notePaths = [...depthOf.keys()]
  const tagRows = await db
    .selectFrom('tags')
    .where('notePath', 'in', notePaths)
    .select(['notePath', 'tag'])
    .orderBy('notePath')
    .orderBy('tagKey')
    .execute()
  const firstTag = new Map<string, string>()
  for (const row of tagRows) {
    if (!firstTag.has(row.notePath)) {
      firstTag.set(row.notePath, row.tag)
    }
  }

  const nodes: LocalGraphNode[] = notePaths.flatMap((notePath) => {
    const note = meta.get(notePath)
    const depth = depthOf.get(notePath)
    if (note === undefined || depth === undefined) {
      return []
    }
    return [
      {
        id: notePath,
        kind: 'note' as const,
        title: note.title,
        dailyDate: note.dailyDate,
        depth,
        tag: firstTag.get(notePath) ?? null,
      },
    ]
  })
  const edges = around.filter((edge) => depthOf.has(edge.source) && depthOf.has(edge.target))

  if (options.tags) {
    const holders = new Map<string, string[]>()
    for (const row of tagRows) {
      const list = holders.get(row.tag)
      if (list === undefined) {
        holders.set(row.tag, [row.notePath])
      } else if (!list.includes(row.notePath)) {
        list.push(row.notePath)
      }
    }
    const ranked = [...holders].sort(
      ([leftTag, left], [rightTag, right]) =>
        right.length - left.length || leftTag.localeCompare(rightTag),
    )
    for (const [tag, holderPaths] of ranked.slice(0, LOCAL_GRAPH_TAG_LIMIT)) {
      const id = `#${tag}`
      nodes.push({ id, kind: 'tag', title: '', dailyDate: null, depth: 1, tag })
      for (const notePath of holderPaths) {
        edges.push({ source: notePath, target: id, weight: 1 })
      }
    }
  }

  return { nodes, edges, hidden }
}
