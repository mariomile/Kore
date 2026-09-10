import { foldTag } from '../markdown'
import { isAppError } from '../errors'
import { readNote } from '../graph/commands'
import { wikiNoteReference } from '../graph/note-reference'
import {
  COLLECTION_DEFINITION_MARKER_KEY,
  extractRelationTargets,
  parseCollectionDefinitionSource,
  relationTarget,
  type CollectionDefinition,
} from '../tags'
import { db } from './db'
import {
  compareCollectionEntries,
  listCollection,
  listNotesWithProperty,
  listTagTypes,
  type CollectionEntry,
  type CollectionSort,
  type CollectionValue,
  type ListCollectionOptions,
} from './collections'
import { deriveCollectionPropertySchema, type CollectionPropertySchema } from './collection-schema'
import { inClauseChunks } from './query-utils'
import {
  attachFormulaColumns,
  attachReverseRelations,
  attachRollups,
  attachTimestampColumns,
} from './rollups'

export type CollectionReferenceResolution =
  | { readonly status: 'resolved'; readonly path: string }
  | { readonly status: 'unresolved'; readonly reference: string }
  | {
      readonly status: 'ambiguous'
      readonly reference: string
      readonly candidates: readonly string[]
    }

export type CollectionDefinitionResolution =
  | { readonly status: 'resolved'; readonly definition: CollectionDefinition }
  | { readonly status: 'unresolved'; readonly reference: string }
  | {
      readonly status: 'ambiguous'
      readonly reference: string
      readonly candidates: readonly string[]
    }

export interface CollectionDiagnostic {
  readonly kind:
    | 'unresolved-reference'
    | 'ambiguous-reference'
    | 'invalid-definition'
    | 'relation-target'
  readonly reference: string
  readonly candidates?: readonly string[]
}

export interface ReusableCollectionResult {
  readonly rows: CollectionEntry[]
  readonly schema: CollectionPropertySchema
  readonly diagnostics: CollectionDiagnostic[]
}

function referenceResult(
  reference: string,
  candidates: readonly string[],
): CollectionReferenceResolution {
  const unique = [...new Set(candidates)].sort()
  if (unique.length === 1) {
    return { status: 'resolved', path: unique[0]! }
  }
  return unique.length === 0
    ? { status: 'unresolved', reference }
    : { status: 'ambiguous', reference, candidates: unique }
}

async function pathsForClaim(key: string): Promise<string[]> {
  if (key === '') {
    return []
  }
  const rows = await db
    .selectFrom('noteClaims')
    .where('key', '=', key)
    .select(['notePath', 'tier'])
    .orderBy('tier')
    .orderBy('notePath')
    .execute()
  const tier = rows[0]?.tier
  return tier === undefined
    ? []
    : rows.filter((row) => row.tier === tier).map((row) => row.notePath)
}

/** Resolve a collection reference without silently choosing an ambiguous id or title. */
export async function resolveCollectionNoteReference(
  reference: string,
): Promise<CollectionReferenceResolution> {
  const target = relationTarget(reference) ?? reference.trim()
  if (target === '') {
    return { status: 'unresolved', reference }
  }

  const idRows = await db
    .selectFrom('notes')
    .where('id', '=', target)
    .select('path')
    .orderBy('path')
    .execute()
  if (idRows.length > 0) {
    return referenceResult(
      reference,
      idRows.map((row) => row.path),
    )
  }

  const parsed = wikiNoteReference(target)
  if (parsed === null || parsed.kind === 'self') {
    return { status: 'unresolved', reference }
  }
  if (parsed.kind === 'path' || parsed.kind === 'pathOrKey') {
    const pathRows = await db
      .selectFrom('notes')
      .where('path', '=', parsed.path)
      .select('path')
      .execute()
    if (pathRows.length > 0 || parsed.kind === 'path') {
      return referenceResult(
        reference,
        pathRows.map((row) => row.path),
      )
    }
  }
  return referenceResult(reference, await pathsForClaim(parsed.key))
}

/** Every valid definition, with reads bounded to indexed marker candidates. */
export async function listCollectionDefinitions(): Promise<CollectionDefinition[]> {
  const candidates = await db
    .selectFrom('noteProperties')
    .innerJoin('notes', 'notes.path', 'noteProperties.notePath')
    .where('noteProperties.key', '=', COLLECTION_DEFINITION_MARKER_KEY)
    .where('noteProperties.value', '=', 'true')
    .where('noteProperties.valueType', '=', 'boolean')
    .where('notes.kind', 'in', ['note', 'daily'])
    .select('notes.path')
    .orderBy('notes.titleKey')
    .orderBy('notes.path')
    .execute()
  const parsed = await Promise.all(
    candidates.map(async ({ path }) => {
      try {
        return parseCollectionDefinitionSource(await readNote(path), path)
      } catch (cause) {
        if (isAppError(cause) && cause.kind === 'notFound') {
          return null
        }
        throw cause
      }
    }),
  )
  return parsed.filter((definition): definition is CollectionDefinition => definition !== null)
}

/** Resolve an id/path/title reference and verify that its note is a definition. */
export async function resolveCollectionDefinition(
  reference: string,
): Promise<CollectionDefinitionResolution> {
  const resolved = await resolveCollectionNoteReference(reference)
  if (resolved.status !== 'resolved') {
    return resolved
  }
  const definition = parseCollectionDefinitionSource(await readNote(resolved.path), resolved.path)
  return definition === null
    ? { status: 'unresolved', reference }
    : { status: 'resolved', definition }
}

function collectionValue(row: {
  value: string
  valueType: string
  valueNumber: number | null
}): CollectionValue {
  const valueType =
    row.valueType === 'number' || row.valueType === 'boolean' || row.valueType === 'list'
      ? row.valueType
      : 'string'
  return { value: row.value, valueType, valueNumber: row.valueNumber }
}

async function entriesByPath(
  paths: readonly string[],
  excludePrivate: boolean,
): Promise<CollectionEntry[]> {
  const entries = new Map<string, CollectionEntry>()
  for (const chunk of inClauseChunks([...new Set(paths)])) {
    let query = db
      .selectFrom('notes')
      .where('path', 'in', chunk)
      .where('kind', 'in', ['note', 'daily'])
    if (excludePrivate) {
      query = query.where('isPrivate', '=', 0)
    }
    const rows = await query.select(['path', 'title', 'mtime', 'isPinned']).execute()
    for (const row of rows) {
      entries.set(row.path, {
        path: row.path,
        title: row.title,
        mtime: row.mtime,
        isPinned: row.isPinned !== 0,
        properties: {},
      })
    }
  }
  for (const chunk of inClauseChunks([...entries.keys()])) {
    const rows = await db
      .selectFrom('noteProperties')
      .where('notePath', 'in', chunk)
      .where('key', '!=', COLLECTION_DEFINITION_MARKER_KEY)
      .select(['notePath', 'key', 'value', 'valueType', 'valueNumber'])
      .execute()
    for (const row of rows) {
      const entry = entries.get(row.notePath)
      if (entry !== undefined) {
        entry.properties[row.key] = collectionValue(row)
      }
    }
  }
  return [...entries.values()]
}

function diagnosticForReference(
  resolved: Exclude<CollectionReferenceResolution, { status: 'resolved' }>,
): CollectionDiagnostic {
  return resolved.status === 'ambiguous'
    ? {
        kind: 'ambiguous-reference',
        reference: resolved.reference,
        candidates: resolved.candidates,
      }
    : { kind: 'unresolved-reference', reference: resolved.reference }
}

async function resolveReferences(
  references: readonly string[],
  diagnostics: CollectionDiagnostic[],
  resolve: (reference: string) => Promise<CollectionReferenceResolution>,
): Promise<Set<string>> {
  const paths = new Set<string>()
  for (const reference of references) {
    const resolved = await resolve(reference)
    if (resolved.status === 'resolved') {
      paths.add(resolved.path)
    } else {
      diagnostics.push(diagnosticForReference(resolved))
    }
  }
  return paths
}

async function relationMatches(
  entry: CollectionEntry,
  key: string,
  targetPath: string,
  resolve: (reference: string) => Promise<CollectionReferenceResolution>,
): Promise<boolean> {
  for (const target of extractRelationTargets(entry.properties[key])) {
    const resolved = await resolve(target)
    if (resolved.status === 'resolved' && resolved.path === targetPath) {
      return true
    }
  }
  return false
}

async function tagKeysForPaths(paths: readonly string[]): Promise<Map<string, Set<string>>> {
  const tagKeys = new Map<string, Set<string>>()
  for (const chunk of inClauseChunks(paths)) {
    const rows = await db
      .selectFrom('tags')
      .where('notePath', 'in', chunk)
      .select(['notePath', 'tagKey'])
      .distinct()
      .execute()
    for (const row of rows) {
      const keys = tagKeys.get(row.notePath) ?? new Set<string>()
      keys.add(row.tagKey)
      tagKeys.set(row.notePath, keys)
    }
  }
  return tagKeys
}

/** Query a reusable mixed-note selection and derive its safe editable schema. */
export async function listReusableCollection(
  definition: CollectionDefinition,
  sorts: readonly CollectionSort[] = [],
  options: ListCollectionOptions = {},
): Promise<ReusableCollectionResult> {
  const diagnostics: CollectionDiagnostic[] = []
  const resolutionCache = new Map<string, Promise<CollectionReferenceResolution>>()
  function resolve(reference: string): Promise<CollectionReferenceResolution> {
    const cacheKey = relationTarget(reference) ?? reference.trim()
    const cached = resolutionCache.get(cacheKey)
    if (cached !== undefined) {
      return cached
    }
    const pending = resolveCollectionNoteReference(reference)
    resolutionCache.set(cacheKey, pending)
    return pending
  }
  const automatic = new Map<string, CollectionEntry>()
  for (const tag of definition.config.sources.tags) {
    for (const entry of await listCollection(tag, [], {
      excludePrivate: options.excludePrivate === true,
    })) {
      automatic.set(entry.path, entry)
    }
  }

  const relation = definition.config.sources.relation
  if (definition.config.sources.tags.length === 0 && relation !== undefined) {
    const propertyRows = await listNotesWithProperty(relation.key)
    for (const entry of await entriesByPath(
      propertyRows.map((row) => row.notePath),
      options.excludePrivate === true,
    )) {
      automatic.set(entry.path, entry)
    }
  }

  if (relation !== undefined) {
    const target = await resolve(relation.target)
    if (target.status !== 'resolved') {
      diagnostics.push({
        kind: 'relation-target',
        reference: relation.target,
        ...(target.status === 'ambiguous' ? { candidates: target.candidates } : {}),
      })
      automatic.clear()
    } else {
      for (const [path, entry] of automatic) {
        if (!(await relationMatches(entry, relation.key, target.path, resolve))) {
          automatic.delete(path)
        }
      }
    }
  }

  const included = await resolveReferences(definition.config.sources.include, diagnostics, resolve)
  const excluded = await resolveReferences(definition.config.sources.exclude, diagnostics, resolve)
  const manualEntries = await entriesByPath([...included], options.excludePrivate === true)
  const selected = new Map(automatic)
  for (const entry of manualEntries) {
    selected.set(entry.path, entry)
  }
  for (const path of excluded) {
    selected.delete(path)
  }

  const rows = [...selected.values()]
  const tagsByPath = await tagKeysForPaths(rows.map((row) => row.path))
  const relevantTags = new Set([...tagsByPath.values()].flatMap((tagKeys) => [...tagKeys]))
  for (const tag of definition.config.sources.tags) {
    relevantTags.add(foldTag(tag))
  }
  const tagTypes = (await listTagTypes()).filter((entry) => relevantTags.has(entry.tagKey))
  const schema = deriveCollectionPropertySchema(tagTypes, rows)
  const rowsByTagSet = new Map<string, CollectionEntry[]>()
  for (const row of rows) {
    const key = [...(tagsByPath.get(row.path) ?? [])].sort().join('\u{0}')
    const group = rowsByTagSet.get(key) ?? []
    group.push(row)
    rowsByTagSet.set(key, group)
  }
  const derivedByPath = new Map<string, CollectionEntry>()
  for (const [tagSet, group] of rowsByTagSet) {
    const rowTags = new Set(tagSet === '' ? [] : tagSet.split('\u{0}'))
    const rowTypes = tagTypes.filter((entry) => rowTags.has(entry.tagKey))
    const rowSchema = deriveCollectionPropertySchema(rowTypes, group)
    const derivedType = {
      properties: rowSchema.fields
        .filter((field) => field.conflict === null && field.declaredBy.length > 0)
        .map((field) => field.property),
    }
    const derived = attachFormulaColumns(
      attachTimestampColumns(
        await attachReverseRelations(await attachRollups(group, derivedType), derivedType),
        derivedType,
      ),
      derivedType,
    )
    for (const row of derived) {
      derivedByPath.set(row.path, row)
    }
  }
  const derivedRows = rows.map((row) => derivedByPath.get(row.path) ?? row)
  if (sorts.length > 0) {
    derivedRows.sort(compareCollectionEntries(sorts))
  } else {
    derivedRows.sort(
      (left, right) => Number(right.isPinned) - Number(left.isPinned) || right.mtime - left.mtime,
    )
  }
  const limited = options.limit === undefined ? derivedRows : derivedRows.slice(0, options.limit)
  return {
    rows: limited,
    schema,
    diagnostics,
  }
}
