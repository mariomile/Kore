import {
  computeRollup,
  extractRelationTargets,
  relationValue,
  rollupSourceFromValue,
  type TagType,
} from '../tags'
import { resolveWikiTarget } from './queries'
import {
  getNoteProperties,
  listCollection,
  type CollectionEntry,
  type CollectionValue,
} from './collections'

export interface RollupLookup {
  resolveWikiTarget: typeof resolveWikiTarget
  getNoteProperties: typeof getNoteProperties
}

const defaultLookup: RollupLookup = {
  resolveWikiTarget,
  getNoteProperties,
}

/**
 * Attach view-only rollup cells onto collection rows. Never writes frontmatter;
 * the synthetic values live only on the in-memory row.
 */
export async function attachRollups(
  entries: readonly CollectionEntry[],
  type: TagType,
  lookup: RollupLookup = defaultLookup,
): Promise<CollectionEntry[]> {
  const rollups = type.properties.filter(
    (property) => property.type === 'rollup' && property.rollup !== undefined,
  )
  if (rollups.length === 0) {
    return [...entries]
  }

  // Memoized per *target string*, not just per resolved ref: the same
  // `[[Author]]` repeated across a thousand rows resolves and reads once.
  const byTarget = new Map<string, Promise<Record<string, CollectionValue> | null>>()

  function propertiesFor(target: string): Promise<Record<string, CollectionValue> | null> {
    const cached = byTarget.get(target)
    if (cached !== undefined) {
      return cached
    }
    const pending = (async () => {
      const resolution = await lookup.resolveWikiTarget(target)
      if (resolution.kind !== 'resolved') {
        return null
      }
      return await lookup.getNoteProperties(resolution.ref)
    })()
    byTarget.set(target, pending)
    return pending
  }

  // Warm the cache concurrently over the distinct targets, so a large
  // collection waits on one batch of lookups instead of a serial N+1 walk.
  const allTargets = new Set<string>()
  for (const entry of entries) {
    for (const property of rollups) {
      const relation = property.rollup?.relation
      if (relation !== undefined) {
        for (const target of extractRelationTargets(entry.properties[relation])) {
          allTargets.add(target)
        }
      }
    }
  }
  await Promise.all([...allTargets].map(propertiesFor))

  const next: CollectionEntry[] = []
  for (const entry of entries) {
    const properties = { ...entry.properties }
    for (const property of rollups) {
      const config = property.rollup
      if (config === undefined) {
        continue
      }
      const targets = extractRelationTargets(properties[config.relation])
      const sources = []
      for (const target of targets) {
        const related = await propertiesFor(target)
        sources.push(rollupSourceFromValue(related?.[config.property]))
      }
      const result = computeRollup(config.aggregation, sources)
      properties[property.key] = {
        value: result.text,
        valueType: result.number === null ? 'string' : 'number',
        valueNumber: result.number,
      }
    }
    next.push({ ...entry, properties })
  }
  return next
}

export interface ReverseLookup {
  resolveWikiTarget: typeof resolveWikiTarget
  listCollection: typeof listCollection
}

const defaultReverseLookup: ReverseLookup = {
  resolveWikiTarget,
  listCollection,
}

/**
 * Attach view-only reverse-relation cells onto collection rows: for each
 * `reverse` property ("rows of `tag` whose `property` links here"), the cell
 * lists the linking rows as wiki links. Like rollups, never written — the
 * synthetic list lives only on the in-memory row, computed from the same
 * index projections the forward direction already maintains.
 */
export async function attachReverseRelations(
  entries: readonly CollectionEntry[],
  type: TagType,
  lookup: ReverseLookup = defaultReverseLookup,
): Promise<CollectionEntry[]> {
  const reverses = type.properties.filter(
    (property) => property.type === 'reverse' && property.reverse !== undefined,
  )
  if (reverses.length === 0 || entries.length === 0) {
    return [...entries]
  }

  // One resolution per distinct target string across every linking row.
  const resolved = new Map<string, Promise<string | null>>()
  function pathFor(target: string): Promise<string | null> {
    const cached = resolved.get(target)
    if (cached !== undefined) {
      return cached
    }
    const pending = lookup
      .resolveWikiTarget(target)
      .then((resolution) => (resolution.kind === 'resolved' ? resolution.ref : null))
    resolved.set(target, pending)
    return pending
  }

  // linksByPath: for each reverse property, this collection's paths → the
  // titles of the other collection's rows whose configured property resolves
  // here — insertion order follows the linking collection's own order.
  const linksByProperty = new Map<string, Map<string, string[]>>()
  for (const property of reverses) {
    const config = property.reverse
    if (config === undefined) {
      continue
    }
    const linking = await lookup.listCollection(config.tag, null)
    const byPath = new Map<string, string[]>()
    await Promise.all(
      linking.map(async (row) => {
        const targets = extractRelationTargets(row.properties[config.property])
        const paths = await Promise.all(targets.map(pathFor))
        for (const path of paths) {
          if (path !== null) {
            const bucket = byPath.get(path)
            if (bucket === undefined) {
              byPath.set(path, [row.title])
            } else if (!bucket.includes(row.title)) {
              bucket.push(row.title)
            }
          }
        }
      }),
    )
    linksByProperty.set(property.key, byPath)
  }

  return entries.map((entry) => {
    const properties = { ...entry.properties }
    for (const property of reverses) {
      const titles = linksByProperty.get(property.key)?.get(entry.path) ?? []
      if (titles.length === 0) {
        // Absent, not an empty list: the footer counts present keys as
        // filled, and a hand-written frontmatter value under a reverse key
        // must not show through as if the view computed it.
        delete properties[property.key]
      } else {
        properties[property.key] = {
          value: JSON.stringify(titles.map((title) => relationValue(title))),
          valueType: 'list',
          valueNumber: titles.length,
        }
      }
    }
    return { ...entry, properties }
  })
}
