import type { CollectionValue, TagType } from '@reflect/core'
import { readCellValue } from '@/components/all-notes/collection-cell'

/**
 * The compact property summary a mobile row shows under a typed tag route
 * (TDR 0005) — the phone-sized stand-in for the desktop Collection columns.
 * At most three set values, schema order, `Name: value` joined with dots;
 * checkboxes appear only when checked (an unchecked box says nothing worth a
 * slot). Empty string when the note has none of the schema's values.
 */
export function propertyLine(type: TagType, properties: Record<string, CollectionValue>): string {
  const parts: string[] = []
  for (const property of type.properties) {
    if (parts.length === 3) {
      break
    }
    const value = properties[property.key]
    if (value === undefined) {
      continue
    }
    const reading = readCellValue(property, value)
    if (property.type === 'checkbox' && !reading.mismatch) {
      if (reading.checked) {
        parts.push(`${property.name} ✓`)
      }
      continue
    }
    if (reading.text !== '') {
      parts.push(`${property.name}: ${reading.text}`)
    }
  }
  return parts.join(' · ')
}
