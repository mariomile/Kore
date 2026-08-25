import { computeRollup, extractRelationTargets, rollupSourceFromValue, type TagType } from '../tags'
import { resolveWikiTarget } from './queries'
import { getNoteProperties, type CollectionEntry, type CollectionValue } from './collections'

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
