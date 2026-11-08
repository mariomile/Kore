import { foldTag } from '../markdown'
import { decodeTagTypeJson, resolveTagTypes, tagDescendants, type TagType } from '../tags'
import { db } from './db'

/**
 * Every stored tag type with inheritance resolved, keyed by folded tag. The
 * table holds one row per definition note (a handful to a few hundred), so
 * reading it whole for each lookup costs less than tracking a cache that
 * every definition save would have to invalidate. `excludePrivate` leaves
 * private definitions out before resolving, so their fields never reach a
 * public child on an outbound surface either.
 */
export async function resolvedTagTypes(excludePrivate = false): Promise<Map<string, TagType>> {
  const rows = excludePrivate
    ? await db
        .selectFrom('tagTypes')
        .innerJoin('notes', 'notes.path', 'tagTypes.notePath')
        .where('notes.isPrivate', '=', 0)
        .select(['tagTypes.tagKey', 'tagTypes.schemaJson'])
        .execute()
    : await db.selectFrom('tagTypes').select(['tagKey', 'schemaJson']).execute()
  const own = new Map<string, TagType>()
  for (const row of rows) {
    try {
      own.set(row.tagKey, decodeTagTypeJson(row.schemaJson))
    } catch {
      // A mangled column is untyped until re-saved, as everywhere else.
    }
  }
  return resolveTagTypes(own)
}

/**
 * The tag keys a collection of `tag` lists: the tag itself and, unless
 * `ownOnly`, every tag that builds on it (`extends:`), directly or not.
 */
export async function collectionTagKeys(tag: string, ownOnly = false): Promise<string[]> {
  const key = foldTag(tag)
  if (ownOnly) {
    return [key]
  }
  return [key, ...tagDescendants(await resolvedTagTypes(), key)]
}

/**
 * The tags that build on `tag`, directly or not, folded and sorted. Empty
 * for a tag nothing extends; the collection shows its "only #tag" filter
 * only when this is not.
 */
export async function listTagChildren(tag: string): Promise<string[]> {
  return tagDescendants(await resolvedTagTypes(), foldTag(tag))
}
