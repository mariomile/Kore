/**
 * Renaming a select/status option in a type's settings. The definition only
 * lists option texts; every member note stores the text itself
 * (`status: Active`). So a rename that touched only the definition would
 * leave those notes on a value the list no longer offers. The settings save
 * therefore rewrites the member notes' values through this mapping.
 *
 * All renames of one property apply at once (a map, not a sequence), so
 * swapping two names (`A → B`, `B → A`) swaps them instead of collapsing
 * both onto one.
 */

/** One property's option renames, `from` → `to`, applied together. */
export type OptionRenameMap = ReadonlyMap<string, string>

/** The rename map for `renames`, dropping no-ops and keeping the first
 * mapping of a repeated `from`. */
export function optionRenameMap(
  renames: readonly { from: string; to: string }[],
): OptionRenameMap {
  const map = new Map<string, string>()
  for (const { from, to } of renames) {
    if (from !== to && !map.has(from)) {
      map.set(from, to)
    }
  }
  return map
}

/**
 * A stored value with `renames` applied, or `undefined` when nothing in it
 * changes (the caller then skips the write). A single option is a string;
 * a multi-select is a list, which keeps its order and drops a duplicate a
 * rename creates. Any other shape is left alone.
 */
export function renameOptionValue(value: unknown, renames: OptionRenameMap): unknown {
  if (typeof value === 'string') {
    const next = renames.get(value)
    return next === undefined ? undefined : next
  }
  if (Array.isArray(value)) {
    let changed = false
    const next: unknown[] = []
    for (const entry of value) {
      const renamed = typeof entry === 'string' ? renames.get(entry) : undefined
      if (renamed !== undefined) {
        changed = true
      }
      const item = renamed ?? entry
      if (!next.includes(item)) {
        next.push(item)
      } else {
        changed = true
      }
    }
    return changed ? next : undefined
  }
  return undefined
}
