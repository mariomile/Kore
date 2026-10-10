import { extractRelationTargets } from '../tags'
import { collectionValue } from './collections'
import { db } from './db'

/**
 * The frontmatter key that names a note's parent. `up: "[[Parent]]"` is the
 * Obsidian/MOC convention (Mario's vault carries it on ~2,500 notes); a list
 * declares several parents.
 */
export const PARENT_PROPERTY_KEY = 'up'

/** Deepest `up:` chain {@link getNoteAncestors} follows before it stops. */
const MAX_ANCESTOR_DEPTH = 32

/** One note in an `up:` hierarchy, as the breadcrumb and children list render it. */
export interface HierarchyNote {
  readonly path: string
  readonly title: string
}

interface HierarchyLinkRow {
  readonly path: string
  readonly title: string
  readonly targetRaw: string | null
  readonly value: string
  readonly valueType: string
  readonly valueNumber: number | null
}

/**
 * Keep the links that `up:` itself declares. The link rows carry no
 * frontmatter key, so a link counts when its raw target is one the `up`
 * value names: a `related: [[X]]` or a body mention of a parent never makes
 * a parent on its own. One row per note, first occurrence wins.
 */
function declaredByUp(rows: readonly HierarchyLinkRow[]): HierarchyNote[] {
  const seen = new Set<string>()
  const notes: HierarchyNote[] = []
  for (const row of rows) {
    if (row.targetRaw === null || seen.has(row.path)) {
      continue
    }
    if (!extractRelationTargets(collectionValue(row)).includes(row.targetRaw.trim())) {
      continue
    }
    seen.add(row.path)
    notes.push({ path: row.path, title: row.title })
  }
  return notes
}

/**
 * The notes `path` names in its `up:` frontmatter, in the order written.
 * Resolution is the backlinks view's, so a parent is found exactly when its
 * link would navigate; an unresolved `up:` target is skipped.
 */
export async function getNoteParents(path: string): Promise<HierarchyNote[]> {
  const rows = await db
    .selectFrom('backlinks')
    .innerJoin('noteProperties', (join) =>
      join
        .onRef('noteProperties.notePath', '=', 'backlinks.sourcePath')
        .on('noteProperties.key', '=', PARENT_PROPERTY_KEY),
    )
    .innerJoin('notes', 'notes.path', 'backlinks.targetPath')
    .where('backlinks.sourcePath', '=', path)
    .where('backlinks.kind', '=', 'wiki')
    .where('backlinks.targetPath', '!=', path)
    .select([
      'notes.path as path',
      'notes.title as title',
      'backlinks.targetRaw',
      'noteProperties.value',
      'noteProperties.valueType',
      'noteProperties.valueNumber',
    ])
    .orderBy('backlinks.posFrom')
    .execute()
  return declaredByUp(rows)
}

/**
 * The breadcrumb above `path`: its `up:` chain, root first, nearest parent
 * last. Each step follows the first declared parent. A cycle stops the walk
 * at the first repeat, so `A → B → A` reads as `B` above A, never a loop.
 */
export async function getNoteAncestors(path: string): Promise<HierarchyNote[]> {
  const chain: HierarchyNote[] = []
  const visited = new Set([path])
  let current = path
  while (chain.length < MAX_ANCESTOR_DEPTH) {
    const parent = (await getNoteParents(current))[0]
    if (parent === undefined || visited.has(parent.path)) {
      break
    }
    visited.add(parent.path)
    chain.push(parent)
    current = parent.path
  }
  return chain.reverse()
}

/**
 * The notes whose `up:` names `path`, by title. Templates are left out like
 * on every other note surface.
 */
export async function getNoteChildren(path: string): Promise<HierarchyNote[]> {
  const rows = await db
    .selectFrom('backlinks')
    .innerJoin('noteProperties', (join) =>
      join
        .onRef('noteProperties.notePath', '=', 'backlinks.sourcePath')
        .on('noteProperties.key', '=', PARENT_PROPERTY_KEY),
    )
    .innerJoin('notes', 'notes.path', 'backlinks.sourcePath')
    .where('backlinks.targetPath', '=', path)
    .where('backlinks.kind', '=', 'wiki')
    .where('backlinks.sourcePath', '!=', path)
    .where('notes.kind', '!=', 'template')
    .select([
      'notes.path as path',
      'notes.title as title',
      'backlinks.targetRaw',
      'noteProperties.value',
      'noteProperties.valueType',
      'noteProperties.valueNumber',
    ])
    .execute()
  return declaredByUp(rows).sort(
    (left, right) => left.title.localeCompare(right.title) || left.path.localeCompare(right.path),
  )
}
