import type { ReactElement } from 'react'
import { isCalendarDate, type CollectionEntry, type TagType } from '@reflect/core'
import { Check } from '@/components/icons'
import { selectOptionBadgeClass } from '@/components/tags/select-colors'
import { formatShortDate } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useSettings } from '@/providers/settings-provider'
import { readCellValue } from './collection-cell'

/** A card stays a glance, not a form — schema order decides which few show. */
const MAX_CHIPS = 4

interface CardChip {
  key: string
  text: string
  /** Property name + value, for the hover that names what the chip is. */
  title: string
  /** The select/status badge wash, `null` for the neutral chip. */
  badge: string | null
  /** A checked checkbox renders its glyph beside the property name. */
  checked: boolean
}

interface CardPropertyChipsProps {
  /** The tag page's schema — chips only exist where one is unambiguous. */
  type: TagType
  entry: CollectionEntry
}

/**
 * A typed note's property values on its grid card (Plan 28 slice 2, the
 * gallery-view ask): read-only chips in schema order — select/status values
 * in the same deterministic badge hue as the table and board, dates in the
 * user's format, a checked checkbox as its name — capped so the card stays a
 * preview, not a row. Empty and mismatched values simply don't show; the
 * table is where mismatches get flagged and fixed.
 */
export function CardPropertyChips({ type, entry }: CardPropertyChipsProps): ReactElement | null {
  const { settings } = useSettings()

  const chips: CardChip[] = []
  for (const property of type.properties) {
    if (chips.length >= MAX_CHIPS) {
      break
    }
    const reading = readCellValue(property, entry.properties[property.key])
    if (reading.mismatch) {
      continue
    }
    if (property.type === 'checkbox') {
      if (reading.checked) {
        chips.push({
          key: property.key,
          text: property.name,
          title: `${property.name}: checked`,
          badge: null,
          checked: true,
        })
      }
      continue
    }
    if (reading.text === '') {
      continue
    }
    const text =
      property.type === 'date' && isCalendarDate(reading.text)
        ? formatShortDate(reading.text, settings.dateFormat)
        : reading.text
    chips.push({
      key: property.key,
      text,
      title: `${property.name}: ${text}`,
      badge:
        property.type === 'select' || property.type === 'status'
          ? selectOptionBadgeClass(reading.text)
          : null,
      checked: false,
    })
  }

  if (chips.length === 0) {
    return null
  }
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      {chips.map((chip) => (
        <span
          key={chip.key}
          title={chip.title}
          className={cn(
            'flex max-w-full items-center gap-0.5 rounded px-1.5 py-px text-2xs font-medium',
            // The same `rounded` badge shape as the table cell, so a status
            // is recognizable across views; neutral values sit on the quiet
            // sunken wash instead of a border (the footer's tag chips keep
            // the bordered pill shape to themselves).
            chip.badge ?? 'bg-surface-hover text-text-secondary',
          )}
        >
          {chip.checked ? <Check aria-hidden className="size-3 shrink-0" /> : null}
          <span className="truncate">{chip.text}</span>
        </span>
      ))}
    </div>
  )
}
