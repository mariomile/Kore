import type { TagProperty } from '@reflect/core'

/**
 * Which collection views a tag schema unlocks (TDR 0005) — the single source
 * of truth shared by the board (grouping), the calendar (dating), and the
 * tag config dialog's live views strip, so the dialog's "add a … to get a
 * Board" hint can never drift from what the views actually require.
 */

/** The property types a board can group by. */
export const GROUPABLE_TYPES: ReadonlySet<TagProperty['type']> = new Set([
  'select',
  'status',
  'checkbox',
  'relation',
  'person',
])

/** Every property a board can group by, schema order. */
export function groupablePropertiesOf(properties: readonly TagProperty[]): TagProperty[] {
  return properties.filter((property) => GROUPABLE_TYPES.has(property.type))
}

/** The property a calendar places rows by: the schema's first `date`. */
export function calendarPropertyOf(properties: readonly TagProperty[]): TagProperty | null {
  return properties.find((property) => property.type === 'date') ?? null
}
