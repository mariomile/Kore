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

  const relatedCache = new Map<string, Record<string, CollectionValue>>()

  async function propertiesFor(target: string): Promise<Record<string, CollectionValue> | null> {
    const resolution = await lookup.resolveWikiTarget(target)
    if (resolution.kind !== 'resolved') {
      return null
    }
    const cached = relatedCache.get(resolution.ref)
    if (cached !== undefined) {
      return cached
    }
    const properties = await lookup.getNoteProperties(resolution.ref)
    relatedCache.set(resolution.ref, properties)
    return properties
  }

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
