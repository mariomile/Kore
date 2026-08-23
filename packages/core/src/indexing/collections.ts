import { sql } from 'kysely'
import { foldTag } from '../markdown'
import { decodeTagTypeJson, type TagType } from '../tags'
import { db } from './db'
import { recallOrder } from './filtered-search'
import type { IndexedPropertyValueType } from '../tags'

/**
 * Collection queries (TDR 0005): the notes carrying a typed tag, with their
 * indexed frontmatter properties. Follows the `listNotes` idiom — an uncapped
 * base query plus a join-shaped second query for the per-note property rows,
 * never a `note_path IN (…)` list.
 */

/** A tag with a type: its folded key and parsed schema. */
export interface TagTypeEntry {
  tagKey: string
  /** The definition note (`tags/<name>.md`). */
  notePath: string
  type: TagType
}

/** One property value on a collection row. */
export interface CollectionValue {
  /** Canonical string form (JSON array text for lists). */
  value: string
  valueType: IndexedPropertyValueType
  /** Numeric sort key, set only for numbers. */
  valueNumber: number | null
}

/** One row of a tag's collection. */
export interface CollectionEntry {
  path: string
  title: string
  mtime: number
  isPinned: boolean
  /** The note's indexed frontmatter values, keyed by frontmatter key. */
  properties: Record<string, CollectionValue>
}

/** Sort a collection on one property key (or a built-in sentinel). */
export interface CollectionSort {
  key: string
  direction: 'asc' | 'desc'
}

/**
 * Sort sentinels for the built-in columns. Property keys can never start
 * with `$` ({@link isPropertyKey}'s grammar), so these never collide with a
 * schema key.
 */
export const TITLE_SORT_KEY = '$title'
export const UPDATED_SORT_KEY = '$updated'

const propertyValueTypes: ReadonlySet<string> = new Set(['string', 'number', 'boolean', 'list'])

function collectionValue(row: {
  value: string
  valueType: string
  valueNumber: number | null
}): CollectionValue {
  return {
    value: row.value,
    valueType: propertyValueTypes.has(row.valueType)
      ? (row.valueType as IndexedPropertyValueType)
      : 'string',
    valueNumber: row.valueNumber,
  }
}

/**
 * The parsed type of one tag, or `null` when the tag has no definition (or a
 * mangled `schema_json` column — tolerated as untyped, never a broken UI).
 */
export async function getTagType(tag: string): Promise<TagType | null> {
  const row = await db
    .selectFrom('tagTypes')
    .where('tagKey', '=', foldTag(tag))
    .select(['schemaJson'])
    .executeTakeFirst()
  if (row === undefined) {
    return null
  }
  try {
    return decodeTagTypeJson(row.schemaJson)
  } catch {
    return null
  }
}

/**
 * The one tolerant decode for `tag_types` result rows: a hand-mangled
 * `schema_json` column loses its type until the definition is re-saved,
 * never a broken query.
 */
function decodeTagTypeRows(
  rows: readonly { tagKey: string; notePath: string; schemaJson: string }[],
): TagTypeEntry[] {
  const entries: TagTypeEntry[] = []
  for (const row of rows) {
    try {
      entries.push({
        tagKey: row.tagKey,
        notePath: row.notePath,
        type: decodeTagTypeJson(row.schemaJson),
      })
    } catch {
      // Skipped — see above.
    }
  }
  return entries
}

/** Every typed tag, alphabetical by key. Mangled schema columns are skipped. */
export async function listTagTypes(): Promise<TagTypeEntry[]> {
  const rows = await db
    .selectFrom('tagTypes')
    .select(['tagKey', 'notePath', 'schemaJson'])
    .orderBy('tagKey')
    .execute()
  return decodeTagTypeRows(rows)
}

/**
 * The typed tags one note carries — its `tags` rows joined against
 * `tag_types` — in key order. Feeds the note's properties panel, whose
 * fields are the union of these schemas.
 */
export async function listNoteTagTypes(path: string): Promise<TagTypeEntry[]> {
  const rows = await db
    .selectFrom('tags')
    .innerJoin('tagTypes', 'tagTypes.tagKey', 'tags.tagKey')
    .where('tags.notePath', '=', path)
    .select(['tagTypes.tagKey', 'tagTypes.notePath', 'tagTypes.schemaJson'])
    .orderBy('tagTypes.tagKey')
    .execute()
  return decodeTagTypeRows(rows)
}

/**
 * Every note carrying frontmatter key `key`, with its stored value — the
 * schema dialog's rename-migration source (values re-typed from the row:
 * the projection round-trips scalars and lists faithfully).
 */
export async function listNotesWithProperty(
  key: string,
): Promise<{ notePath: string; value: CollectionValue }[]> {
  const rows = await db
    .selectFrom('noteProperties')
    .where('key', '=', key)
    .select(['notePath', 'value', 'valueType', 'valueNumber'])
    .orderBy('notePath')
    .execute()
  return rows.map((row) => ({ notePath: row.notePath, value: collectionValue(row) }))
}

/** The typed YAML value a stored property row round-trips to. */
export function propertyRowValue(value: CollectionValue): unknown {
  switch (value.valueType) {
    case 'number':
      return value.valueNumber ?? Number(value.value)
    case 'boolean':
      return value.value === 'true'
    case 'list': {
      try {
        const entries = JSON.parse(value.value) as unknown
        return Array.isArray(entries) ? entries.map(String) : value.value
      } catch {
        return value.value
      }
    }
    default:
      return value.value
  }
}

/** One note's indexed frontmatter values, keyed by frontmatter key. */
export async function getNoteProperties(path: string): Promise<Record<string, CollectionValue>> {
  const rows = await db
    .selectFrom('noteProperties')
    .where('notePath', '=', path)
    .select(['key', 'value', 'valueType', 'valueNumber'])
    .execute()
  const properties: Record<string, CollectionValue> = {}
  for (const row of rows) {
    properties[row.key] = collectionValue(row)
  }
  return properties
}

export interface ListCollectionOptions {
  /**
   * Drop `private: true` rows in SQL. Outbound surfaces (the AI tool) pass
   * this so a private note's row never even reaches their layer — their live
   * on-disk re-check stays the gate; this is the index-side prefilter.
   * Local surfaces (the Collection table) omit it: privacy blocks external
   * services, not the user's own screen (TDR 0005).
   */
  excludePrivate?: boolean
}

/**
 * The notes carrying `tag` (regular and daily, like the tag-filtered All
 * Notes list) with their property values. Unsorted collections keep the list
 * order (pinned first, then newest); a property sort orders missing values
 * last, numbers by their numeric key, everything else by string,
 * case-insensitive.
 */
export async function listCollection(
  tag: string,
  sort: CollectionSort | null = null,
  options: ListCollectionOptions = {},
): Promise<CollectionEntry[]> {
  const tagKey = foldTag(tag)
  let baseQuery = db
    .selectFrom('tags')
    .innerJoin('notes', 'notes.path', 'tags.notePath')
    .where('tags.tagKey', '=', tagKey)
    .where('notes.kind', 'in', ['note', 'daily'])
    .select(['notes.path', 'notes.title', 'notes.mtime', 'notes.isPinned'])
  if (options.excludePrivate === true) {
    baseQuery = baseQuery.where('notes.isPrivate', '=', 0)
  }
  // The branches build differently-typed queries (the property-sort branch
  // joins an extra table), so each executes where it is built.
  const rows =
    sort === null
      ? await recallOrder(true)
          .reduce((query, order) => query.orderBy(order), baseQuery)
          .execute()
      : sort.key === TITLE_SORT_KEY
        ? await baseQuery
            .orderBy(sql`"notes"."title" collate nocase ${sql.raw(sort.direction)}`)
            .orderBy('notes.mtime', 'desc')
            .execute()
        : sort.key === UPDATED_SORT_KEY
          ? await baseQuery.orderBy('notes.mtime', sort.direction).orderBy('notes.path').execute()
          : await baseQuery
              .leftJoin('noteProperties as sortProperty', (join) =>
                join
                  .onRef('sortProperty.notePath', '=', 'notes.path')
                  .on('sortProperty.key', '=', sort.key),
              )
              // Missing values last regardless of direction, then the numeric key
              // (set only for numbers), then the string form. One ordering serves
              // every value type without consulting the schema.
              .orderBy(sql`"sort_property"."value" is null`)
              .orderBy('sortProperty.valueNumber', sort.direction)
              .orderBy(sql`"sort_property"."value" collate nocase ${sql.raw(sort.direction)}`)
              .orderBy('notes.mtime', 'desc')
              .execute()
  if (rows.length === 0) {
    return []
  }

  // Property rows for the same note set, via the same predicates (join, not
  // IN — the list is uncapped and must stay clear of the parameter ceiling).
  let propertiesQuery = db
    .selectFrom('noteProperties')
    .innerJoin('notes', 'notes.path', 'noteProperties.notePath')
    .innerJoin('tags', 'tags.notePath', 'notes.path')
    .where('tags.tagKey', '=', tagKey)
    .where('notes.kind', 'in', ['note', 'daily'])
  if (options.excludePrivate === true) {
    propertiesQuery = propertiesQuery.where('notes.isPrivate', '=', 0)
  }
  const propertyRows = await propertiesQuery
    .select([
      'noteProperties.notePath',
      'noteProperties.key',
      'noteProperties.value',
      'noteProperties.valueType',
      'noteProperties.valueNumber',
    ])
    .execute()
  const propertiesByPath = new Map<string, Record<string, CollectionValue>>()
  for (const row of propertyRows) {
    const properties = propertiesByPath.get(row.notePath) ?? {}
    properties[row.key] = collectionValue(row)
    propertiesByPath.set(row.notePath, properties)
  }

  return rows.map((row) => ({
    path: row.path,
    title: row.title,
    mtime: row.mtime,
    isPinned: row.isPinned !== 0,
    properties: propertiesByPath.get(row.path) ?? {},
  }))
}
