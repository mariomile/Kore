import { RESERVED_FRONTMATTER_KEYS } from './tag-type'
import type { Frontmatter } from '../markdown'

/**
 * Generic frontmatter-property extraction for the `note_properties`
 * projection (TDR 0005). Every non-reserved scalar (or array-of-scalars)
 * frontmatter key of every note is indexed, regardless of any tag schema —
 * the index must never depend on schema state, or a definition edit would
 * silently require re-indexing every note that carries the tag.
 */

/** How a property value is stored in `note_properties.value_type`. */
export type IndexedPropertyValueType = 'string' | 'number' | 'boolean' | 'list'

/** One `note_properties` row: a canonical string form plus a numeric sort key. */
export interface IndexedProperty {
  /** Frontmatter key, verbatim. */
  key: string
  /** Canonical string form (JSON array text for lists). */
  value: string
  valueType: IndexedPropertyValueType
  /** Numeric sort key, set only for `number` values. */
  valueNumber: number | null
}

function isScalar(value: unknown): value is string | number | boolean {
  return (
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    typeof value === 'boolean'
  )
}

/**
 * Flatten a note's frontmatter into `note_properties` rows. Objects, nested
 * arrays, nulls, and non-finite numbers are skipped — storage is honest YAML,
 * and typing beyond scalar/list is the schema's job at display time (a
 * date-shaped string stays a string).
 */
export function extractNoteProperties(frontmatter: Frontmatter): IndexedProperty[] {
  const properties: IndexedProperty[] = []
  for (const [key, value] of Object.entries(frontmatter)) {
    if (RESERVED_FRONTMATTER_KEYS.has(key)) {
      continue
    }
    if (isScalar(value)) {
      properties.push({
        key,
        value: String(value),
        valueType: typeof value as 'string' | 'number' | 'boolean',
        valueNumber: typeof value === 'number' ? value : null,
      })
    } else if (Array.isArray(value) && value.length > 0 && value.every(isScalar)) {
      properties.push({
        key,
        value: JSON.stringify(value.map(String)),
        valueType: 'list',
        valueNumber: null,
      })
    }
  }
  return properties
}
