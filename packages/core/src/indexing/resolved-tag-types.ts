import { z } from 'zod'
import { TAGS_DIR } from '../graph/paths'
import { call } from '../ipc/invoke'
import { foldTag } from '../markdown'
import {
  decodeTagTypeJson,
  encodeTagTypeJson,
  resolveTagTypes,
  tagDescendants,
  withStoredStartingValues,
  type TagType,
} from '../tags'
import { db } from './db'

/**
 * Tag inheritance in the index (Plan 33 B2). `resolveTagTypes` is the one
 * place the policy runs: after every index write that touches a definition
 * note, {@link refreshTagTypeResolutions} recomputes every tag type and
 * stores the effective schemas and the descendant lists in `tag_types`
 * (migration 0025). Every reader (the app's queries below, `kore` and
 * `kore mcp`) reads those columns instead of resolving again.
 *
 * The public columns are the same computation with private definitions
 * left out, for outbound surfaces: a private parent's fields never reach an
 * agent through a public child, and a private definition has no public
 * schema at all. A NULL column reads as untyped: the pass has not stored
 * that row yet (a mangled `schema_json` it skipped, or the instant between
 * a write and its pass). Migration 0025 ships with a projection bump
 * (`PROJECTION_VERSION` 30), so an existing index is rebuilt and the pass
 * fills every row before anything reads it.
 */

/** Does a write to these paths need the inheritance pass? */
export function touchesTagDefinitions(paths: Iterable<string>): boolean {
  for (const path of paths) {
    if (path.startsWith(`${TAGS_DIR}/`)) {
      return true
    }
  }
  return false
}

const voidSchema = z.null()

/**
 * Recompute and store every tag type's inheritance result. The table holds
 * one row per definition note (a handful to a few hundred), so one read and
 * one write transaction cover the whole graph. A mangled `schema_json` row
 * is left out: readers treat it as untyped, as they always have.
 */
export async function refreshTagTypeResolutions(generation: number): Promise<void> {
  const rows = await db
    .selectFrom('tagTypes')
    .leftJoin('notes', 'notes.path', 'tagTypes.notePath')
    .select(['tagTypes.tagKey', 'tagTypes.schemaJson', 'notes.isPrivate'])
    .execute()
  const all = new Map<string, TagType>()
  const publicTypes = new Map<string, TagType>()
  for (const row of rows) {
    let type: TagType
    try {
      type = decodeTagTypeJson(row.schemaJson)
    } catch {
      continue
    }
    all.set(row.tagKey, type)
    // A definition missing from `notes` fails closed, like `listTagTypes`.
    if (row.isPrivate === 0) {
      publicTypes.set(row.tagKey, type)
    }
  }
  if (all.size === 0) {
    return
  }
  const resolved = resolveTagTypes(all)
  const resolvedPublic = resolveTagTypes(publicTypes)
  const resolutions = [...all.keys()].map((tagKey) => {
    const publicType = resolvedPublic.get(tagKey)
    return {
      tagKey,
      // Each property carries its validated starting value (Plan 33 B4) so
      // the CLI never re-validates a `default`.
      resolvedJson: encodeTagTypeJson(withStoredStartingValues(resolved.get(tagKey)!)),
      publicResolvedJson:
        publicType === undefined ? null : encodeTagTypeJson(withStoredStartingValues(publicType)),
      descendantsJson: JSON.stringify(tagDescendants(all, tagKey)),
      publicDescendantsJson: JSON.stringify(
        publicTypes.has(tagKey) ? tagDescendants(publicTypes, tagKey) : [],
      ),
    }
  })
  await call('index_tag_types_resolve', { rows: resolutions, generation }, voidSchema)
}

/**
 * {@link refreshTagTypeResolutions} for callers whose own write already
 * committed: a failure is logged, never thrown, so one bad pass cannot fail
 * indexing a note. The stored columns keep their last values until the next
 * pass, and every graph open runs one (`syncIndex`), so it heals itself.
 */
export async function refreshTagTypeResolutionsSafely(generation: number): Promise<void> {
  try {
    await refreshTagTypeResolutions(generation)
  } catch (error: unknown) {
    console.error(
      'index: tag inheritance pass failed; it runs again on the next tag write or graph open',
      error,
    )
  }
}

/** Which stored view a read wants: everything, or the outbound one. */
export interface TagTypeReadOptions {
  /**
   * Read the public columns: private definitions are untyped, and their
   * fields are not in any child's schema. Outbound surfaces pass this.
   */
  excludePrivate?: boolean
}

/** The stored columns one tag type read decodes from. */
export interface StoredTagTypeColumns {
  resolvedJson: string | null
  publicResolvedJson: string | null
}

/**
 * The effective type a stored row carries: the full schema, or under
 * `excludePrivate` the public one (none for a private definition). `null`
 * when the pass stored nothing for the row, which fails closed.
 */
export function decodeStoredTagType(
  row: StoredTagTypeColumns,
  options: TagTypeReadOptions = {},
): TagType | null {
  const column = options.excludePrivate === true ? row.publicResolvedJson : row.resolvedJson
  if (column === null) {
    return null
  }
  try {
    return decodeTagTypeJson(column)
  } catch {
    return null
  }
}

const storedKeysSchema = z.array(z.string())

/** A stored descendants column as keys; NULL (pass not run yet) reads as none. */
function decodeStoredKeys(column: string | null): string[] {
  if (column === null) {
    return []
  }
  try {
    return storedKeysSchema.parse(JSON.parse(column))
  } catch {
    return []
  }
}

/** The tags that build on `tagKey`, from the stored columns. */
async function storedDescendants(tagKey: string, excludePrivate: boolean): Promise<string[]> {
  const row = await db
    .selectFrom('tagTypes')
    .where('tagKey', '=', tagKey)
    .select(['descendantsJson', 'publicDescendantsJson'])
    .executeTakeFirst()
  if (row === undefined) {
    return []
  }
  return decodeStoredKeys(excludePrivate ? row.publicDescendantsJson : row.descendantsJson)
}

/** Which tags a collection spans (Plan 33 B2). */
export interface CollectionScope {
  /**
   * List only the notes carrying the tag itself (or a tag nested under it),
   * leaving out the notes of tags that build on it: the collection's
   * "only #tag" filter.
   */
  ownOnly?: boolean
  /** Leave out child tags whose definitions are private (outbound reads). */
  excludePrivate?: boolean
}

/**
 * The tag keys a collection of `tag` lists: the tag itself and, unless
 * `ownOnly`, every tag that builds on it (`extends:`), directly or not.
 */
export async function collectionTagKeys(
  tag: string,
  scope: CollectionScope = {},
): Promise<string[]> {
  const key = foldTag(tag)
  if (scope.ownOnly === true) {
    return [key]
  }
  return [key, ...(await storedDescendants(key, scope.excludePrivate === true))]
}

/**
 * The tags that build on `tag`, directly or not, folded and sorted. Empty
 * for a tag nothing extends; the collection shows its "only #tag" filter
 * only when this is not.
 */
export async function listTagChildren(tag: string): Promise<string[]> {
  return await storedDescendants(foldTag(tag), false)
}

/**
 * Would saving `tag` with `parents` as its `extends:` close a loop? Returns
 * the parent that closes it (the tag itself for a self-reference), or
 * `null` when the save is fine. The writers call this before writing a
 * definition, so a loop only ever exists if someone typed it by hand, and
 * the pass cuts it then (`resolveTagTypes`).
 */
export async function tagExtendsLoop(
  tag: string,
  parents: readonly string[],
): Promise<string | null> {
  const key = foldTag(tag)
  const descendants = new Set(await storedDescendants(key, false))
  for (const entry of parents) {
    const parent = foldTag(entry)
    if (parent === key || descendants.has(parent)) {
      return parent
    }
  }
  return null
}

/**
 * The typed tags `tag` may build on, folded and sorted: every typed tag
 * except `tag` itself and the tags that already build on it (choosing one
 * of those would close a loop). Feeds the "Builds on" picker.
 */
export async function listTagParentCandidates(tag: string): Promise<string[]> {
  const key = foldTag(tag)
  const descendants = new Set(await storedDescendants(key, false))
  const rows = await db.selectFrom('tagTypes').select(['tagKey']).orderBy('tagKey').execute()
  return rows
    .map((row) => row.tagKey)
    .filter((candidate) => candidate !== key && !descendants.has(candidate))
}
