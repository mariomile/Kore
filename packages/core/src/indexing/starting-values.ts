import { sql } from 'kysely'
import { nextNumberKeys, startingValues, type StartingValueContext, type TagType } from '../tags'
import { db } from './db'
import { collectionTagKeys } from './resolved-tag-types'
import { carriesAnyTagOrNested } from './tag-match'

/**
 * The index side of starting values (Plan 33 B4): `next-number` needs the
 * highest number the tag's notes already hold. The policy itself is pure
 * (`tags/starting-values.ts`); this only reads.
 */

/**
 * The next free number for each `next-number` field of `type`: one more
 * than the highest number any note of the tag's collection (child tags
 * included, like the collection lists them) holds under that key, or 1 when
 * none does. Two notes born in the same instant can draw the same number;
 * the user fixes it by hand, as in any app without a server.
 */
export async function nextNumbers(
  tag: string,
  type: TagType | null | undefined,
): Promise<Map<string, number>> {
  const keys = nextNumberKeys(type)
  const result = new Map<string, number>()
  if (keys.length === 0) {
    return result
  }
  const members = await collectionTagKeys(tag)
  const rows = await db
    .selectFrom('noteProperties')
    .where('noteProperties.key', 'in', keys)
    .where('noteProperties.valueNumber', 'is not', null)
    .where(carriesAnyTagOrNested('"note_properties"."note_path"', members))
    .groupBy('noteProperties.key')
    .select([
      'noteProperties.key',
      sql<number | null>`max("note_properties"."value_number")`.as('highest'),
    ])
    .execute()
  const highest = new Map(rows.map((row) => [row.key, row.highest]))
  for (const key of keys) {
    const top = highest.get(key)
    result.set(key, top === null || top === undefined ? 1 : Math.floor(top) + 1)
  }
  return result
}

/**
 * The context a note joining `tag` now is stamped with, read up front (the
 * write transforms are synchronous). A failed index read leaves the
 * `next-number` fields empty rather than failing the write: the note
 * matters more than its number.
 */
export async function startingValueContext(
  tag: string,
  type: TagType | null | undefined,
  at: Date = new Date(),
): Promise<StartingValueContext> {
  try {
    return { at, nextNumbers: await nextNumbers(tag, type) }
  } catch {
    return { at }
  }
}

/** {@link startingValues} for a note joining `tag` now (a new row). */
export async function rowStartingValues(
  tag: string,
  type: TagType | null | undefined,
  at: Date = new Date(),
): Promise<Record<string, unknown>> {
  return startingValues(type, await startingValueContext(tag, type, at))
}
