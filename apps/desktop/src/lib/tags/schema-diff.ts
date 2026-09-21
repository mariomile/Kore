import type { TagProperty } from '@reflect/core'

/**
 * What a proposed tag schema changes, row by row — the reading the chat
 * review card shows before anything is written. Pure over the two property
 * lists and the proposal's renames, so the card renders and the tests assert
 * the same thing.
 */

export type SchemaRowKind = 'added' | 'removed' | 'changed' | 'same'

export interface SchemaDiffRow {
  kind: SchemaRowKind
  /** The property as it will be (absent on a removal). */
  next: TagProperty | null
  /** The property as it is now (absent on an addition). */
  previous: TagProperty | null
}

/**
 * One row per property of the proposed schema, in its order, followed by the
 * properties the proposal drops. A renamed property is one `changed` row
 * (old key on the left, new on the right) rather than a removal beside an
 * addition — which is also why `renames` is read here and not inferred:
 * nothing in the two lists alone distinguishes a rename from a swap.
 */
export function diffTagSchema(
  previous: readonly TagProperty[],
  next: readonly TagProperty[],
  renames: readonly { from: string; to: string }[],
): SchemaDiffRow[] {
  const previousByKey = new Map(previous.map((property) => [property.key, property]))
  const sourceKey = new Map(renames.map((rename) => [rename.to, rename.from]))
  const consumed = new Set<string>()
  const rows: SchemaDiffRow[] = next.map((property) => {
    const before = previousByKey.get(sourceKey.get(property.key) ?? property.key) ?? null
    if (before === null) {
      return { kind: 'added', next: property, previous: null }
    }
    consumed.add(before.key)
    return {
      kind: JSON.stringify(before) === JSON.stringify(property) ? 'same' : 'changed',
      next: property,
      previous: before,
    }
  })
  for (const property of previous) {
    if (!consumed.has(property.key)) {
      rows.push({ kind: 'removed', next: null, previous: property })
    }
  }
  return rows
}
