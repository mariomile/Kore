import type { TagProperty, TagType } from './tag-type'

/**
 * Tags that build on other tags (Plan 33 B2). A definition's `extends:`
 * names parent tags; its effective schema is the parents' fields followed by
 * its own, and the parent's collection also lists the children's notes.
 *
 * Inheritance is resolved here, over the per-tag schemas, never written
 * into member notes or into the child's definition: the index pass
 * (`refreshTagTypeResolutions`) stores the result after every definition
 * write, so editing the parent reaches every child, and the child's file
 * keeps only what the user wrote in it. Reads are tolerant
 * the way every schema read is: a parent with no definition contributes
 * nothing, and a loop (`#a` builds on `#b` builds on `#a`) is cut at the
 * edge that closes it. Saving a definition that would close a loop is
 * refused by the writers (`tagExtendsLoop`, over the stored child lists).
 */

/**
 * The effective schema of every tag in `types` (folded key to own type):
 * inherited properties first, in parent order and each parent's own order,
 * then the tag's own. When the tag declares a key a parent also declares,
 * the tag's property wins and takes the parent's slot, so a column keeps
 * its place. Two parents declaring one key: the first listed wins.
 * `extends` survives on the result, so callers can still name the parents.
 */
export function resolveTagTypes(types: ReadonlyMap<string, TagType>): Map<string, TagType> {
  const cache = new Map<string, TagType>()
  const resolved = new Map<string, TagType>()
  for (const key of types.keys()) {
    const result = resolveOne(key, types, cache, [])
    if (result !== null) {
      resolved.set(key, result.type)
    }
  }
  return resolved
}

/**
 * One tag's effective type. `cut` reports that a loop edge was dropped
 * somewhere below: such a result depends on where the walk started, so it is
 * never cached, and each tag in a loop sees the others' fields ahead of its
 * own, the way it would without the closing edge.
 */
function resolveOne(
  key: string,
  types: ReadonlyMap<string, TagType>,
  cache: Map<string, TagType>,
  path: readonly string[],
): { type: TagType; cut: boolean } | null {
  const cached = cache.get(key)
  if (cached !== undefined) {
    return { type: cached, cut: false }
  }
  const own = types.get(key)
  if (own === undefined) {
    return null
  }
  const trail = [...path, key]
  const inherited: TagProperty[] = []
  const claimed = new Set<string>()
  let cut = false
  for (const parent of own.extends ?? []) {
    if (trail.includes(parent)) {
      cut = true
      continue
    }
    const parentResult = resolveOne(parent, types, cache, trail)
    cut ||= parentResult?.cut ?? false
    for (const property of parentResult?.type.properties ?? []) {
      if (!claimed.has(property.key)) {
        claimed.add(property.key)
        inherited.push(property)
      }
    }
  }
  const ownByKey = new Map(own.properties.map((property) => [property.key, property]))
  const properties = inherited.map((property) => ownByKey.get(property.key) ?? property)
  for (const property of own.properties) {
    if (!claimed.has(property.key)) {
      properties.push(property)
    }
  }
  const type: TagType = inherited.length === 0 ? own : { ...own, properties }
  if (!cut) {
    cache.set(key, type)
  }
  return { type, cut }
}

/**
 * Every tag that builds on `key`, directly or through another child, in
 * key order and without `key` itself. Feeds the parent's collection, which
 * lists the children's notes too. Loops are walked once.
 */
export function tagDescendants(types: ReadonlyMap<string, TagType>, key: string): string[] {
  const children = new Map<string, string[]>()
  for (const [child, type] of types) {
    for (const parent of type.extends ?? []) {
      const list = children.get(parent) ?? []
      list.push(child)
      children.set(parent, list)
    }
  }
  const found = new Set<string>()
  const queue = [key]
  while (queue.length > 0) {
    const next = queue.shift()!
    for (const child of children.get(next) ?? []) {
      if (child !== key && !found.has(child)) {
        found.add(child)
        queue.push(child)
      }
    }
  }
  return [...found].sort()
}
