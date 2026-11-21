import { sql } from 'kysely'
import { foldTag } from '../markdown'
import {
  COLLECTION_DEFINITION_MARKER_KEY,
  decodeStoredList,
  tagAncestors,
  type TagType,
} from '../tags'
import { db } from './db'
import {
  collectionTagKeys,
  decodeStoredTagType,
  type StoredTagTypeColumns,
  type CollectionScope,
  type TagTypeReadOptions,
} from './resolved-tag-types'
import { recallOrder } from './filtered-search'
import { carriesAnyTagOrNested } from './tag-match'
import type { IndexedPropertyValueType } from '../tags'

/**
 * Collection queries (TDR 0005): the notes carrying a typed tag, with their
 * indexed frontmatter properties. Follows the `listNotes` idiom — an uncapped
 * base query plus a join-shaped second query for the per-note property rows.
 * A `note_path IN (…)` list appears only under an explicit row `limit`,
 * where it is bounded by construction.
 */

/** A tag with a type: its folded key and parsed schema. */
export interface TagTypeEntry {
  tagKey: string
  /** The definition note (`tags/<name>.md`). */
  notePath: string
  type: TagType
}

/** A tag a note carries, with its schema when a definition declares one. */
export interface NoteTagEntry {
  /** Display casing, as first indexed across the graph. */
  tag: string
  /** Folded key — what membership and the definition path are keyed on. */
  tagKey: string
  /** The tag's schema, or `null` when no definition note declares one. */
  type: TagType | null
  /** The definition note (`tags/<name>.md`), or `null` when untyped. */
  definitionPath: string | null
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

/**
 * The sorts `listCollection` should actually run. An `updated` column stores
 * nothing — its cells are attached from the row's mtime — so a sort on its
 * key rides the built-in mtime sentinel instead of the (empty) property
 * join, which would read every row as "missing, last".
 */
export function effectiveCollectionSorts(
  type: TagType | null,
  sorts: readonly CollectionSort[],
): CollectionSort[] {
  if (type === null) {
    return [...sorts]
  }
  return sorts.map((sort) =>
    type.properties.some((property) => property.type === 'updated' && property.key === sort.key)
      ? { key: UPDATED_SORT_KEY, direction: sort.direction }
      : sort,
  )
}

/** One cell as the sort sees it: a number when the row stored one, else its text. */
function sortValue(entry: CollectionEntry, key: string): number | string | null {
  if (key === TITLE_SORT_KEY) {
    return entry.title
  }
  if (key === UPDATED_SORT_KEY) {
    return entry.mtime
  }
  const value = entry.properties[key]
  if (value === undefined || value.value === '') {
    return null
  }
  return value.valueNumber ?? value.value
}

/**
 * A comparator for a sort chain — the second key breaks the first's ties,
 * and so on — with the SQL ordering's semantics on every key: missing
 * values last regardless of direction, numbers before strings, strings
 * case-insensitive; a fully tied pair keeps newest-first.
 */
export function compareCollectionEntries(
  sorts: readonly CollectionSort[],
): (left: CollectionEntry, right: CollectionEntry) => number {
  return (left, right) => {
    for (const sort of sorts) {
      const a = sortValue(left, sort.key)
      const b = sortValue(right, sort.key)
      if (a === null && b === null) {
        continue
      }
      if (a === null) {
        return 1
      }
      if (b === null) {
        return -1
      }
      const sign = sort.direction === 'desc' ? -1 : 1
      if (typeof a === 'number' && typeof b === 'number') {
        if (a !== b) {
          return (a - b) * sign
        }
        continue
      }
      if (typeof a === 'number') {
        return -1
      }
      if (typeof b === 'number') {
        return 1
      }
      const order = a.localeCompare(b, undefined, { sensitivity: 'base' })
      if (order !== 0) {
        return order * sign
      }
    }
    return right.mtime - left.mtime
  }
}

const propertyValueTypes: ReadonlySet<string> = new Set(['string', 'number', 'boolean', 'list'])

/** A stored `note_properties` row as its typed value; unknown types read as strings. */
export function collectionValue(row: {
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
 * The schema a sub-tag without its own definition inherits from its nearest
 * defined ancestor: properties (already resolved through higher ancestors) and
 * icon, never the ancestor's own saved views, template, or home folder.
 */
function inheritedFromAncestor(ancestor: TagType): TagType {
  return {
    properties: ancestor.properties,
    ...(ancestor.icon !== undefined ? { icon: ancestor.icon } : {}),
  }
}

/**
 * The parsed type of one tag, or `null` when neither the tag nor any `/`
 * ancestor has a definition (or a mangled `schema_json` column — tolerated as
 * untyped, never a broken UI). Inherited properties are merged in: the index
 * stores each tag's effective schema (Plan 33 B2; TDR 0005 Amendment I,
 * `refreshTagTypeResolutions`). `excludePrivate` reads the outbound view,
 * where a private definition is untyped.
 */
export async function getTagType(
  tag: string,
  options: TagTypeReadOptions = {},
): Promise<TagType | null> {
  const key = foldTag(tag)
  const ancestors = tagAncestors(key)
  if (ancestors.length === 0) {
    const row = await db
      .selectFrom('tagTypes')
      .where('tagKey', '=', key)
      .select(TAG_TYPE_COLUMNS)
      .executeTakeFirst()
    return row === undefined ? null : decodeStoredTagType(row, options)
  }
  const rows = await db
    .selectFrom('tagTypes')
    .where('tagKey', 'in', [key, ...ancestors])
    .select(['tagTypes.tagKey', ...TAG_TYPE_COLUMNS])
    .execute()
  const byKey = new Map(rows.map((row) => [row.tagKey, row]))
  const direct = byKey.get(key)
  if (direct !== undefined) {
    return decodeStoredTagType(direct, options)
  }
  // Walk nearest ancestor first; its resolved schema already includes higher
  // ancestors and explicit `extends`.
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const ancestorRow = byKey.get(ancestors[index]!)
    if (ancestorRow === undefined) {
      continue
    }
    const ancestorType = decodeStoredTagType(ancestorRow, options)
    if (ancestorType !== null) {
      return inheritedFromAncestor(ancestorType)
    }
  }
  return null
}

/** The `tag_types` columns every typed read decodes ({@link decodeStoredTagType}). */
const TAG_TYPE_COLUMNS = ['tagTypes.resolvedJson', 'tagTypes.publicResolvedJson'] as const

/**
 * The one tolerant decode for `tag_types` result rows: a hand-mangled
 * `schema_json` column loses its type until the definition is re-saved,
 * never a broken query.
 */
function decodeTagTypeRows(
  rows: readonly (StoredTagTypeColumns & { tagKey: string; notePath: string })[],
  options: TagTypeReadOptions = {},
): TagTypeEntry[] {
  const entries: TagTypeEntry[] = []
  for (const row of rows) {
    const type = decodeStoredTagType(row, options)
    if (type !== null) {
      entries.push({ tagKey: row.tagKey, notePath: row.notePath, type })
    }
  }
  return entries
}

export interface ListTagTypesOptions {
  /**
   * Drop types whose definition note is `private: true` (or is not in the
   * `notes` index at all — fail closed), and read the public schemas, so a
   * private parent's fields are not in a public child's. Outbound surfaces
   * pass this: a private definition's icon and schema are that note's content.
   */
  excludePrivate?: boolean
}

/** Every typed tag, alphabetical by key. Mangled schema columns are skipped. */
export async function listTagTypes(options: ListTagTypesOptions = {}): Promise<TagTypeEntry[]> {
  const rows =
    options.excludePrivate === true
      ? await db
          .selectFrom('tagTypes')
          .innerJoin('notes', 'notes.path', 'tagTypes.notePath')
          .where('notes.isPrivate', '=', 0)
          .select(['tagTypes.tagKey', 'tagTypes.notePath', ...TAG_TYPE_COLUMNS])
          .orderBy('tagTypes.tagKey')
          .execute()
      : await db
          .selectFrom('tagTypes')
          .select(['tagTypes.tagKey', 'tagTypes.notePath', ...TAG_TYPE_COLUMNS])
          .orderBy('tagTypes.tagKey')
          .execute()
  return decodeTagTypeRows(rows, options)
}

/**
 * Resolve ancestor tag definitions in one batched query for sub-tags that carry
 * no definition note of their own (TDR 0005 Amendment I). Returns an empty map
 * without touching SQLite when no sub-tag needs a lookup.
 */
async function loadAncestorTagTypeRows(
  missingTagKeys: readonly string[],
): Promise<Map<string, StoredTagTypeColumns & { tagKey: string; notePath: string }>> {
  const ancestorKeys = new Set<string>()
  for (const tagKey of missingTagKeys) {
    for (const ancestor of tagAncestors(tagKey)) {
      ancestorKeys.add(ancestor)
    }
  }
  if (ancestorKeys.size === 0) {
    return new Map()
  }
  const rows = await db
    .selectFrom('tagTypes')
    .where('tagKey', 'in', [...ancestorKeys])
    .select(['tagTypes.tagKey', 'tagTypes.notePath', ...TAG_TYPE_COLUMNS])
    .execute()
  return new Map(rows.map((row) => [row.tagKey, row]))
}

function resolveInheritedSubtag(
  tagKey: string,
  ancestorRows: ReadonlyMap<string, StoredTagTypeColumns & { tagKey: string; notePath: string }>,
): { type: TagType; notePath: string } | null {
  const ancestors = tagAncestors(tagKey)
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const ancestorRow = ancestorRows.get(ancestors[index]!)
    if (ancestorRow === undefined) {
      continue
    }
    const ancestorType = decodeStoredTagType(ancestorRow)
    if (ancestorType !== null) {
      return { type: inheritedFromAncestor(ancestorType), notePath: ancestorRow.notePath }
    }
  }
  return null
}

/**
 * The typed tags one note carries — its `tags` rows joined against
 * `tag_types` (including sub-tags inheriting from defined `/` ancestors) — in
 * key order. Feeds the note's properties panel, whose fields are the union of
 * these schemas.
 */
export async function listNoteTagTypes(path: string): Promise<TagTypeEntry[]> {
  const tags = await listTagsOnNote(path)
  return tags.flatMap<TagTypeEntry>((entry) =>
    entry.type === null || entry.definitionPath === null
      ? []
      : [{ tagKey: entry.tagKey, notePath: entry.definitionPath, type: entry.type }],
  )
}

/**
 * Every tag one note is a member of (not the ones its prose only mentions),
 * schema-bearing or not, in key order. Since TDR 0005 Amendment A a tag *is* a
 * collection whether or not a definition note declares properties; since
 * Amendment I a sub-tag without its own definition inherits properties from
 * its nearest defined `/` ancestor.
 *
 * A definition the inheritance pass skipped (a `schema_json` that fails to
 * parse) degrades to `type: null`
 * (the tag is still carried) rather than dropping the row, the same
 * tolerance {@link listNoteTagTypes} applies.
 */
export async function listTagsOnNote(path: string): Promise<NoteTagEntry[]> {
  const rows = await db
    .selectFrom('tags')
    .leftJoin('tagTypes', 'tagTypes.tagKey', 'tags.tagKey')
    .where('tags.notePath', '=', path)
    .where('tags.member', '=', 1)
    .select(['tags.tag', 'tags.tagKey', 'tagTypes.notePath', ...TAG_TYPE_COLUMNS])
    .orderBy('tags.tagKey')
    .execute()
  const missingSubtags = rows
    .filter((row) => row.notePath === null && row.tagKey.includes('/'))
    .map((row) => row.tagKey)
  const ancestorRows = await loadAncestorTagTypeRows(missingSubtags)

  return rows.map((row) => {
    if (row.notePath !== null) {
      const type = decodeStoredTagType(row)
      return {
        tag: row.tag,
        tagKey: row.tagKey,
        type,
        definitionPath: type === null ? null : row.notePath,
      }
    }
    const inherited = resolveInheritedSubtag(row.tagKey, ancestorRows)
    return {
      tag: row.tag,
      tagKey: row.tagKey,
      type: inherited?.type ?? null,
      definitionPath: inherited?.notePath ?? null,
    }
  })
}

/**
 * Every note carrying frontmatter key `key`, with its stored value — the
 * schema dialog's rename-migration source (values re-typed from the row:
 * the projection round-trips scalars and lists faithfully).
 */
export async function listNotesWithProperty(
  key: string,
  options: { tag?: string } = {},
): Promise<{ notePath: string; value: CollectionValue }[]> {
  let query = db.selectFrom('noteProperties').where('noteProperties.key', '=', key)
  if (options.tag !== undefined) {
    // Only the tag's own members: another type can use the same key with
    // its own meaning, and an option rename must not reach it.
    const tagKey = foldTag(options.tag)
    query = query.where(({ exists, selectFrom }) =>
      exists(
        selectFrom('tags')
          .select('tags.notePath')
          .whereRef('tags.notePath', '=', 'noteProperties.notePath')
          .where('tags.tagKey', '=', tagKey)
          .where('tags.member', '=', 1),
      ),
    )
  }
  const rows = await query
    .select([
      'noteProperties.notePath',
      'noteProperties.value',
      'noteProperties.valueType',
      'noteProperties.valueNumber',
    ])
    .orderBy('noteProperties.notePath')
    .execute()
  return rows.map((row) => ({
    notePath: row.notePath,
    value: collectionValue(row),
  }))
}

/** The typed YAML value a stored property row round-trips to. */
export function propertyRowValue(value: CollectionValue): unknown {
  switch (value.valueType) {
    case 'number':
      return value.valueNumber ?? Number(value.value)
    case 'boolean':
      return value.value === 'true'
    case 'list':
      return decodeStoredList(value.value) ?? value.value
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
    if (row.key === COLLECTION_DEFINITION_MARKER_KEY) {
      continue
    }
    properties[row.key] = collectionValue(row)
  }
  return properties
}

export interface ListCollectionOptions extends CollectionScope {
  /**
   * Drop `private: true` rows in SQL (and private child tags). Outbound surfaces (the AI tool) pass
   * this so a private note's row never even reaches their layer — their live
   * on-disk re-check stays the gate; this is the index-side prefilter.
   * Local surfaces (the Collection table) omit it: privacy blocks external
   * services, not the user's own screen (TDR 0005).
   */
  excludePrivate?: boolean
  /**
   * Cap the returned rows in SQL (after the sort). Bounded surfaces (the AI
   * tool's page) pass this so a huge collection never materializes; the
   * property rows are then fetched by an IN over the kept paths instead of
   * the uncapped join.
   */
  limit?: number
}

/**
 * The notes carrying `tag` or a tag nested under it (regular and daily, like
 * the tag-filtered All Notes list), plus the notes of tags that build on it
 * unless `ownOnly`, with their property values. Unsorted collections keep the list
 * order (pinned first, then newest); a property sort orders missing values
 * last, numbers by their numeric key, everything else by string,
 * case-insensitive.
 */
export async function listCollection(
  tag: string,
  sorts: readonly CollectionSort[] = [],
  options: ListCollectionOptions = {},
): Promise<CollectionEntry[]> {
  // SQL orders by the chain's head; a longer chain re-sorts the (uncapped,
  // fully materialized) rows in memory below with the same semantics.
  const sort = sorts[0] ?? null
  const tagKeys = await collectionTagKeys(tag, options)
  let baseQuery = db
    .selectFrom('notes')
    .where('notes.kind', 'in', ['note', 'daily'])
    .where(carriesAnyTagOrNested('"notes"."path"', tagKeys))
    .select(['notes.path', 'notes.title', 'notes.mtime', 'notes.isPinned'])
  if (options.excludePrivate === true) {
    baseQuery = baseQuery.where('notes.isPrivate', '=', 0)
  }
  if (options.limit !== undefined) {
    baseQuery = baseQuery.limit(options.limit)
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
    .where('notes.kind', 'in', ['note', 'daily'])
    .where(carriesAnyTagOrNested('"notes"."path"', tagKeys))
  if (options.excludePrivate === true) {
    propertiesQuery = propertiesQuery.where('notes.isPrivate', '=', 0)
  }
  const propertyRows =
    options.limit !== undefined
      ? await db
          .selectFrom('noteProperties')
          .where(
            'noteProperties.notePath',
            'in',
            rows.map((row) => row.path),
          )
          .select([
            'noteProperties.notePath',
            'noteProperties.key',
            'noteProperties.value',
            'noteProperties.valueType',
            'noteProperties.valueNumber',
          ])
          .execute()
      : await propertiesQuery
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
    if (row.key === COLLECTION_DEFINITION_MARKER_KEY) {
      continue
    }
    const properties = propertiesByPath.get(row.notePath) ?? {}
    properties[row.key] = collectionValue(row)
    propertiesByPath.set(row.notePath, properties)
  }

  const entries = rows.map((row) => ({
    path: row.path,
    title: row.title,
    mtime: row.mtime,
    isPinned: row.isPinned !== 0,
    properties: propertiesByPath.get(row.path) ?? {},
  }))
  return sorts.length > 1 ? entries.sort(compareCollectionEntries(sorts)) : entries
}
