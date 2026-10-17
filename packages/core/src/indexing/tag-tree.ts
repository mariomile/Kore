import { sql } from 'kysely'
import { db } from './db'
import type { ListNoteTagsOptions, NoteTagFacet } from './note-list'

/**
 * Nested tags (`#domain/ai`, `#type/person`) as a tree — the sidebar's Types
 * section. Obsidian's semantics: a tag is the parent of every tag that
 * extends it by a `/` segment, and a parent stands for its whole subtree, so
 * its count and its page cover notes carrying any descendant. A parent need
 * not be used on its own to appear; one that is still opens the same page.
 */

/** One prefix of the tag hierarchy with its distinct non-daily note count. */
export interface TagTreeCount {
  /** Folded tag path, e.g. `domain/ai`. */
  readonly key: string
  /** Display casing of the same path, e.g. `Domain/ai`. */
  readonly tag: string
  /** Non-daily notes carrying this tag or any tag below it. */
  readonly count: number
}

/** One node of the tag tree. */
export interface TagTreeNode {
  /** Folded tag path — the key icons and the tag filter compare on. */
  readonly key: string
  /** Full display tag (`Domain/ai`) — what a row navigates to. */
  readonly tag: string
  /** The last segment in display casing (`ai`). */
  readonly name: string
  /** Non-daily notes carrying this tag or any descendant, each counted once. */
  readonly count: number
  /** Child tags, ordered by key like the flat facet list. */
  readonly children: readonly TagTreeNode[]
}

interface MutableNode {
  key: string
  tag: string
  name: string
  count: number
  children: MutableNode[]
}

function lastSegment(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function freeze(node: MutableNode): TagTreeNode {
  return { ...node, children: node.children.map(freeze) }
}

/**
 * Group per-prefix counts into a tree. Rows may arrive in any order; a row
 * whose parent prefix is missing hangs from its nearest present ancestor (or
 * the root), and a row with an empty last segment (`#a/`) is dropped — its
 * notes are already counted by its parent.
 */
export function buildTagTree(rows: readonly TagTreeCount[]): TagTreeNode[] {
  const sorted = [...rows].sort((left, right) =>
    left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
  )
  const byKey = new Map<string, MutableNode>()
  const roots: MutableNode[] = []
  for (const row of sorted) {
    const name = lastSegment(row.tag)
    if (name === '' || byKey.has(row.key)) {
      continue
    }
    const node: MutableNode = { key: row.key, tag: row.tag, name, count: row.count, children: [] }
    byKey.set(row.key, node)
    let parent: MutableNode | undefined
    for (
      let slash = row.key.lastIndexOf('/');
      slash > 0;
      slash = row.key.lastIndexOf('/', slash - 1)
    ) {
      parent = byKey.get(row.key.slice(0, slash))
      if (parent !== undefined) {
        break
      }
    }
    if (parent === undefined) {
      roots.push(node)
    } else {
      parent.children.push(node)
    }
  }
  return roots.map(freeze)
}

/** Whether any tag in the tree has children — i.e. the vault nests tags. */
export function hasNestedTags(tree: readonly TagTreeNode[]): boolean {
  return tree.some((node) => node.children.length > 0)
}

interface TagPrefixRow extends TagTreeCount {
  /** 1 when some note carries this exact tag, 0 for a pure parent prefix. */
  readonly used: number
}

/**
 * Every tag prefix carried by a non-daily note, with its distinct note count.
 * A recursive CTE walks each tag's `/` segments on the folded key and the
 * display tag in step (folding never adds or removes a `/`), so `domain`
 * appears once with every note under `domain/…` counted once, even a note
 * tagged both `#domain/ai` and `#domain/design`. `used` marks the prefixes
 * that are whole tags (their segments are exhausted on some note).
 */
async function listTagPrefixes(options: ListNoteTagsOptions): Promise<TagPrefixRow[]> {
  const privacy = options.excludePrivate === true ? sql`AND notes.is_private = 0` : sql``
  const result = await sql<TagPrefixRow>`
    WITH RECURSIVE parts(note_path, key_prefix, tag_prefix, key_rest, tag_rest) AS (
      SELECT tags.note_path, '', '', tags.tag_key || '/', tags.tag || '/'
      FROM tags JOIN notes ON notes.path = tags.note_path
      WHERE notes.kind = 'note' ${privacy}
      UNION
      SELECT
        note_path,
        key_prefix || CASE WHEN key_prefix = '' THEN '' ELSE '/' END
          || substr(key_rest, 1, instr(key_rest, '/') - 1),
        tag_prefix || CASE WHEN tag_prefix = '' THEN '' ELSE '/' END
          || substr(tag_rest, 1, instr(tag_rest, '/') - 1),
        substr(key_rest, instr(key_rest, '/') + 1),
        substr(tag_rest, instr(tag_rest, '/') + 1)
      FROM parts
      WHERE key_rest <> '' AND instr(tag_rest, '/') > 0
    )
    SELECT
      key_prefix AS key,
      min(tag_prefix) AS tag,
      count(DISTINCT note_path) AS count,
      max(key_rest = '') AS used
    FROM parts
    WHERE key_prefix <> ''
    GROUP BY key_prefix
    ORDER BY key_prefix
  `.execute(db)
  return result.rows
}

/** Every tag prefix on a non-daily note with its subtree note count. */
export async function listTagTreeCounts(
  options: ListNoteTagsOptions = {},
): Promise<TagTreeCount[]> {
  return (await listTagPrefixes(options)).map(({ key, tag, count }) => ({ key, tag, count }))
}

/**
 * Every tag used on a non-daily note, alphabetical by folded key, counting the
 * notes the tag's page lists: those carrying it or any tag nested under it.
 */
export async function listUsedTagCounts(
  options: ListNoteTagsOptions = {},
): Promise<NoteTagFacet[]> {
  return (await listTagPrefixes(options))
    .filter((row) => row.used !== 0)
    .map(({ tag, count }) => ({ tag, count }))
}

/** The Types section's tree: every tag on a non-daily note, nested on `/`. */
export async function getTagTree(): Promise<TagTreeNode[]> {
  return buildTagTree(await listTagTreeCounts())
}
