import type { TagProperty } from '@reflect/core'

/**
 * Which collection views a tag schema unlocks (TDR 0005) — the single source
 * of truth shared by the board (grouping), the calendar (dating), and the
 * tag config dialog's live views strip, so the dialog's "add a … to get a
 * Board" hint can never drift from what the views actually require.
 */

/**
 * The single-valued property types the table can group rows by — one shelf
 * per row. The board additionally groups by `multiselect`
 * ({@link BOARD_GROUPABLE_TYPES}): its lanes tolerate the same card
 * appearing in several, which a table's flat selection order cannot.
 */
export const GROUPABLE_TYPES: ReadonlySet<TagProperty['type']> = new Set([
  'select',
  'status',
  'checkbox',
  'relation',
  'person',
])

/** The property types a board can lane by — the table's set plus lists. */
export const BOARD_GROUPABLE_TYPES: ReadonlySet<TagProperty['type']> = new Set([
  ...GROUPABLE_TYPES,
  'multiselect',
])

/** Every property the table can group rows by, schema order. */
export function groupablePropertiesOf(properties: readonly TagProperty[]): TagProperty[] {
  return properties.filter((property) => GROUPABLE_TYPES.has(property.type))
}

/** Every property a board can lane by, schema order. */
export function boardGroupablePropertiesOf(properties: readonly TagProperty[]): TagProperty[] {
  return properties.filter((property) => BOARD_GROUPABLE_TYPES.has(property.type))
}

/** The property a calendar places rows by: the schema's first `date`. */
export function calendarPropertyOf(properties: readonly TagProperty[]): TagProperty | null {
  return properties.find((property) => property.type === 'date') ?? null
}
