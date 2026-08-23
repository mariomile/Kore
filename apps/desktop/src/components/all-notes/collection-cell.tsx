import type { ReactElement } from 'react'
import type { CollectionValue, TagProperty } from '@reflect/core'
import { Check } from '@/components/icons'
import { cn } from '@/lib/utils'

/** How a stored value reads under the column's declared type. */
export interface CellReading {
  /** Single-line display text ('' for an absent value). */
  text: string
  /** True when the checkbox column should render a check glyph. */
  checked: boolean
  /**
   * The stored YAML doesn't fit the declared type (a string under a number
   * column, a scalar under a multi-select). Shown raw with a warning tint —
   * tolerated, never destroyed (TDR 0005).
   */
  mismatch: boolean
}

/** Decode a `note_properties` value for display under `property`'s type. */
export function readCellValue(
  property: TagProperty,
  value: CollectionValue | undefined,
): CellReading {
  if (value === undefined) {
    return { text: '', checked: false, mismatch: false }
  }
  const raw = value.value
  switch (property.type) {
    case 'checkbox':
      return value.valueType === 'boolean'
        ? { text: '', checked: raw === 'true', mismatch: false }
        : { text: raw, checked: false, mismatch: true }
    case 'number':
      return value.valueType === 'number'
        ? { text: raw, checked: false, mismatch: false }
        : { text: raw, checked: false, mismatch: true }
    case 'multiselect': {
      if (value.valueType === 'list') {
        try {
          const entries = JSON.parse(raw) as unknown
          if (Array.isArray(entries)) {
            return { text: entries.map(String).join(', '), checked: false, mismatch: false }
          }
        } catch {
          // Fall through to the raw form below.
        }
        return { text: raw, checked: false, mismatch: true }
      }
      // A single scalar under a multi-select reads as a one-entry list.
      return { text: raw, checked: false, mismatch: false }
    }
    default:
      return value.valueType === 'list'
        ? { text: raw, checked: false, mismatch: true }
        : { text: raw, checked: false, mismatch: false }
  }
}

interface CollectionCellProps {
  property: TagProperty
  value: CollectionValue | undefined
  selected: boolean
}

/** One typed cell of a Collection row — single-line, truncating (the fixed
 * density row height is a layout contract with the virtualizer). */
export function CollectionCell({ property, value, selected }: CollectionCellProps): ReactElement {
  const reading = readCellValue(property, value)
  if (property.type === 'checkbox' && !reading.mismatch) {
    return (
      <span
        role="img"
        aria-label={reading.checked ? 'Checked' : 'Unchecked'}
        className="flex items-center"
      >
        {reading.checked ? (
          <Check aria-hidden className="size-3.5 text-text-secondary" />
        ) : (
          <span aria-hidden className="size-3.5 rounded-sm border border-border" />
        )}
      </span>
    )
  }
  return (
    <span
      className={cn(
        'truncate text-[13px]',
        property.type === 'number' && !reading.mismatch && 'text-right tabular-nums',
        reading.mismatch
          ? 'text-amber-700 dark:text-amber-300'
          : selected
            ? 'text-accent'
            : 'text-text-secondary',
      )}
      title={reading.mismatch ? 'Value does not match the property type' : undefined}
    >
      {reading.text}
    </span>
  )
}
