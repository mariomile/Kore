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
 *
 * Deleting an option is the same problem: the notes still store its text.
 * A deleted option either merges into another one (a rename onto that
 * option's text) or is taken off the notes (`to: null`).
 */

/** One option's change: its new text, or `null` to take it off the notes. */
export interface OptionChange {
  from: string
  to: string | null
}

/** One property's option changes, `from` → `to`, applied together. */
export type OptionRenameMap = ReadonlyMap<string, string | null>

/** The rename map for `renames`, dropping no-ops and keeping the first
 * mapping of a repeated `from`. */
export function optionRenameMap(renames: readonly OptionChange[]): OptionRenameMap {
  const map = new Map<string, string | null>()
  for (const { from, to } of renames) {
    if (from !== to && !map.has(from)) {
      map.set(from, to)
    }
  }
  return map
}

/**
 * A stored value with `renames` applied: `undefined` when nothing in it
 * changes (the caller then skips the write), `null` when the property is
 * left without a value (the caller removes it from the note). A single
 * option is a string; a multi-select is a list, which keeps its order,
 * drops a removed option and a duplicate a rename creates, and reads as
 * `null` once empty. Any other shape is left alone.
 */
export function renameOptionValue(value: unknown, renames: OptionRenameMap): unknown {
  if (typeof value === 'string') {
    return renames.get(value)
  }
  if (Array.isArray(value)) {
    let changed = false
    const next: unknown[] = []
    for (const entry of value) {
      const renamed = typeof entry === 'string' ? renames.get(entry) : undefined
      if (renamed !== undefined) {
        changed = true
      }
      const item = renamed === undefined ? entry : renamed
      if (item !== null && !next.includes(item)) {
        next.push(item)
      } else {
        changed = true
      }
    }
    if (!changed) {
      return undefined
    }
    return next.length === 0 ? null : next
  }
  return undefined
}

/**
 * How many of `values` (one stored property value per note) use each
 * option: a single option counts once, a multi-select once per entry. The
 * type settings read it to tell how many notes deleting an option touches.
 */
export function optionUseCounts(values: readonly unknown[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const value of values) {
    const entries: readonly unknown[] = Array.isArray(value) ? value : [value]
    for (const entry of new Set(entries)) {
      if (typeof entry === 'string') {
        counts.set(entry, (counts.get(entry) ?? 0) + 1)
      }
    }
  }
  return counts
}
