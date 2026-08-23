import type { ReactElement } from 'react'
import {
  isCalendarDate,
  relationDisplay,
  type CollectionValue,
  type TagProperty,
} from '@reflect/core'
import { Check } from '@/components/icons'
import { formatShortDate } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useSettings } from '@/providers/settings-provider'

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

/** Decode a stored `list` column ('["a","b"]') into its entries, or `null`
 * when the text isn't a well-formed list (shown raw as a mismatch). */
function decodeStoredList(raw: string): string[] | null {
  try {
    const entries = JSON.parse(raw) as unknown
    return Array.isArray(entries) ? entries.map(String) : null
  } catch {
    return null
  }
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
    case 'relation': {
      if (value.valueType !== 'string') {
        return { text: raw, checked: false, mismatch: true }
      }
      // `[[Target]]` displays as its title (alias when the link carries
      // one); a bare string still reads as a human reference, not an error.
      return { text: relationDisplay(raw) ?? raw, checked: false, mismatch: false }
    }
    case 'relations': {
      if (value.valueType === 'string') {
        // A single link under a multi-relation reads as a one-entry list.
        return { text: relationDisplay(raw) ?? raw, checked: false, mismatch: false }
      }
      const entries = value.valueType === 'list' ? decodeStoredList(raw) : null
      return entries === null
        ? { text: raw, checked: false, mismatch: true }
        : {
            text: entries.map((entry) => relationDisplay(entry) ?? entry).join(', '),
            checked: false,
            mismatch: false,
          }
    }
    case 'multiselect': {
      if (value.valueType !== 'list') {
        // A single scalar under a multi-select reads as a one-entry list.
        return { text: raw, checked: false, mismatch: false }
      }
      const entries = decodeStoredList(raw)
      return entries === null
        ? { text: raw, checked: false, mismatch: true }
        : { text: entries.join(', '), checked: false, mismatch: false }
    }
    default:
      return value.valueType === 'list'
        ? { text: raw, checked: false, mismatch: true }
        : { text: raw, checked: false, mismatch: false }
  }
}

/** The checkbox property's read-only face, shared with the note properties
 * panel so a styling or a11y fix reaches both surfaces at once. */
export function CheckboxFace({ checked }: { checked: boolean }): ReactElement {
  return checked ? (
    <Check aria-hidden className="size-3.5 text-text-secondary" />
  ) : (
    <span aria-hidden className="size-3.5 rounded-sm border border-border" />
  )
}

interface CollectionCellProps {
  property: TagProperty
  value: CollectionValue | undefined
  selected: boolean
}

/** One typed cell of a Collection row — single-line, truncating (the fixed
 * density row height is a layout contract with the virtualizer). */
export function CollectionCell({ property, value, selected }: CollectionCellProps): ReactElement {
  const { settings } = useSettings()
  const reading = readCellValue(property, value)
  // Storage stays honest ISO; only the face follows the user's date format.
  const text =
    property.type === 'date' && !reading.mismatch && isCalendarDate(reading.text)
      ? formatShortDate(reading.text, settings.dateFormat)
      : reading.text
  if (property.type === 'checkbox' && !reading.mismatch) {
    return (
      <span
        role="img"
        aria-label={reading.checked ? 'Checked' : 'Unchecked'}
        className="flex items-center"
      >
        <CheckboxFace checked={reading.checked} />
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
      {text}
    </span>
  )
}
