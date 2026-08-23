import { useMemo, useState, type ReactElement } from 'react'
import type { CollectionEntry, TagType } from '@reflect/core'
import { Close, Filter } from '@/components/icons'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { readCellValue } from './collection-cell'

/** One active collection filter: rows whose display text equals `text`. */
export interface CollectionFilter {
  key: string
  text: string
}

interface CollectionFilterMenuProps {
  type: TagType
  /** The unfiltered rows — the value inventory is derived from them. */
  entries: readonly CollectionEntry[] | undefined
  filters: readonly CollectionFilter[]
  onChange: (filters: CollectionFilter[]) => void
}

const MAX_VALUES_PER_PROPERTY = 12

/** Apply the active filters (ANDed, display-text equality). */
export function applyCollectionFilters(
  type: TagType,
  entries: readonly CollectionEntry[],
  filters: readonly CollectionFilter[],
): CollectionEntry[] {
  if (filters.length === 0) {
    return [...entries]
  }
  const propertiesByKey = new Map(type.properties.map((property) => [property.key, property]))
  return entries.filter((entry) =>
    filters.every((filter) => {
      const property = propertiesByKey.get(filter.key)
      if (property === undefined) {
        return true
      }
      return readCellValue(property, entry.properties[filter.key]).text === filter.text
    }),
  )
}

/**
 * The Collection's property filter (TDR 0005): a combobox over the values
 * the rows actually hold, grouped by property (schema options are offered
 * even when no row holds them yet, so a select can be filtered "to empty").
 * Filters AND together; picking an active value clears it. Ephemeral by
 * design — a filter is a glance, the sort is the view's durable order.
 */
export function CollectionFilterMenu({
  type,
  entries,
  filters,
  onChange,
}: CollectionFilterMenuProps): ReactElement | null {
  const [open, setOpen] = useState(false)

  const valuesByProperty = useMemo(() => {
    const inventory = new Map<string, string[]>()
    for (const property of type.properties) {
      if (property.type === 'checkbox') {
        continue // two states, low value as a filter chip for now
      }
      const values = new Set<string>(property.options ?? [])
      for (const entry of entries ?? []) {
        const text = readCellValue(property, entry.properties[property.key]).text
        if (text !== '') {
          values.add(text)
        }
      }
      if (values.size > 0) {
        inventory.set(property.key, [...values].slice(0, MAX_VALUES_PER_PROPERTY))
      }
    }
    return inventory
  }, [type, entries])

  if (valuesByProperty.size === 0 && filters.length === 0) {
    return null
  }

  const isActive = (key: string, text: string): boolean =>
    filters.some((filter) => filter.key === key && filter.text === text)
  const toggle = (key: string, text: string): void => {
    onChange(
      isActive(key, text)
        ? filters.filter((filter) => !(filter.key === key && filter.text === text))
        : [...filters, { key, text }],
    )
  }

  return (
    <div className="flex items-center gap-1.5">
      {filters.map((filter) => (
        <button
          key={`${filter.key}:${filter.text}`}
          type="button"
          onClick={() => toggle(filter.key, filter.text)}
          className="flex items-center gap-1 rounded-full bg-surface-hover px-2.5 py-1 text-xs text-text-secondary transition-colors hover:text-text"
        >
          <span className="max-w-32 truncate">
            {type.properties.find((property) => property.key === filter.key)?.name ?? filter.key}:{' '}
            {filter.text}
          </span>
          <Close aria-hidden className="size-3 shrink-0" />
        </button>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          aria-label="Filter by property"
          aria-pressed={filters.length > 0}
          className={cn(
            'flex size-6 items-center justify-center rounded-full transition-colors',
            filters.length > 0
              ? 'bg-surface text-text shadow-sm'
              : 'text-text-muted hover:text-text-secondary',
          )}
        >
          <Filter aria-hidden className="size-3.5" />
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={6} className="w-60 p-0">
          <Command label="Filter by property">
            <CommandInput placeholder="Filter values…" />
            <CommandList>
              <CommandEmpty>No values to filter by.</CommandEmpty>
              {[...valuesByProperty].map(([key, values]) => {
                const property = type.properties.find((entry) => entry.key === key)
                return (
                  <CommandGroup key={key} heading={property?.name ?? key}>
                    {values.map((text) => (
                      <CommandItem
                        key={text}
                        value={`${property?.name ?? key} ${text}`}
                        onSelect={() => toggle(key, text)}
                      >
                        <span className="min-w-0 flex-1 truncate">{text}</span>
                        {isActive(key, text) ? (
                          <Close aria-hidden className="size-3 shrink-0 text-text-muted" />
                        ) : null}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )
              })}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}
