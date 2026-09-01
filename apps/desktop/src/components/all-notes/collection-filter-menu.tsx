import { useMemo, useState, type ReactElement } from 'react'
import type { CollectionEntry, TagProperty, TagType } from '@reflect/core'
import { Close, Filter, Plus } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { readCellValue } from './collection-cell'

/** How one collection filter compares a row's display value. */
export type CollectionFilterOperator = 'is' | 'contains' | 'gt' | 'lt' | 'empty' | 'notEmpty'

/** One active collection filter. `text` is '' for empty/notEmpty. */
export interface CollectionFilter {
  key: string
  operator: CollectionFilterOperator
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

/** The operators a property type sensibly offers. */
export function operatorsFor(property: TagProperty): CollectionFilterOperator[] {
  switch (property.type) {
    case 'number':
    case 'rating':
    case 'date':
    case 'created':
    case 'updated':
      return ['is', 'gt', 'lt', 'empty', 'notEmpty']
    case 'select':
    case 'status':
      return ['is', 'empty', 'notEmpty']
    case 'checkbox':
      return ['empty', 'notEmpty']
    default:
      return ['is', 'contains', 'empty', 'notEmpty']
  }
}

const OPERATOR_LABELS: Record<CollectionFilterOperator, string> = {
  is: 'is',
  contains: 'contains',
  gt: '>',
  lt: '<',
  empty: 'is empty',
  notEmpty: 'is set',
}

/** Numbers compare numerically; ISO dates (and everything else) as text. */
function compare(property: TagProperty, text: string, against: string): number {
  if (property.type === 'number' || property.type === 'rating') {
    const left = Number(text)
    const right = Number(against)
    if (Number.isFinite(left) && Number.isFinite(right)) {
      return left - right
    }
  }
  return text.localeCompare(against)
}

function matches(property: TagProperty, entry: CollectionEntry, filter: CollectionFilter): boolean {
  const value = entry.properties[filter.key]
  const text = readCellValue(property, value).text
  switch (filter.operator) {
    case 'is':
      return text === filter.text
    case 'contains':
      return text.toLowerCase().includes(filter.text.toLowerCase())
    case 'gt':
      return text !== '' && compare(property, text, filter.text) > 0
    case 'lt':
      return text !== '' && compare(property, text, filter.text) < 0
    case 'empty':
      return value === undefined || (text === '' && property.type !== 'checkbox')
    case 'notEmpty':
      return value !== undefined && (text !== '' || property.type === 'checkbox')
  }
}

/**
 * Apply the active filters: equality picks on the same property OR together
 * ("status is done, or reading"), every other condition must hold, and
 * properties AND across each other — so `status: done|reading AND rating > 3`
 * reads the way it looks.
 */
export function applyCollectionFilters(
  type: TagType,
  entries: readonly CollectionEntry[],
  filters: readonly CollectionFilter[],
): CollectionEntry[] {
  if (filters.length === 0) {
    return [...entries]
  }
  const propertiesByKey = new Map(type.properties.map((property) => [property.key, property]))
  const byKey = new Map<string, CollectionFilter[]>()
  for (const filter of filters) {
    byKey.set(filter.key, [...(byKey.get(filter.key) ?? []), filter])
  }
  return entries.filter((entry) =>
    [...byKey].every(([key, keyFilters]) => {
      const property = propertiesByKey.get(key)
      if (property === undefined) {
        return true
      }
      const equals = keyFilters.filter((filter) => filter.operator === 'is')
      const others = keyFilters.filter((filter) => filter.operator !== 'is')
      const anyEqual =
        equals.length === 0 || equals.some((filter) => matches(property, entry, filter))
      return anyEqual && others.every((filter) => matches(property, entry, filter))
    }),
  )
}

/** The chip's text for one filter. */
function filterLabel(type: TagType, filter: CollectionFilter): string {
  const name = type.properties.find((property) => property.key === filter.key)?.name ?? filter.key
  if (filter.operator === 'empty' || filter.operator === 'notEmpty') {
    return `${name} ${OPERATOR_LABELS[filter.operator]}`
  }
  if (filter.operator === 'is') {
    return `${name}: ${filter.text}`
  }
  return `${name} ${OPERATOR_LABELS[filter.operator]} ${filter.text}`
}

/**
 * The Collection's property filter (TDR 0005): one-click equality picks over
 * the values the rows actually hold, plus a condition builder for the rest
 * (contains, greater/less than, empty, set). Equality picks on one property
 * OR together, everything else ANDs. Ephemeral by design — a filter is a
 * glance; a keeper belongs in a saved view.
 */
export function CollectionFilterMenu({
  type,
  entries,
  filters,
  onChange,
}: CollectionFilterMenuProps): ReactElement | null {
  const [open, setOpen] = useState(false)
  // Every property joins the condition builder — a checkbox filters as
  // checked / not (its operatorsFor pair). Only the one-click value
  // inventory skips checkboxes: its chips are equality picks, which a
  // checkbox never offers.
  const filterable = type.properties
  const inventoried = useMemo(
    () => type.properties.filter((property) => property.type !== 'checkbox'),
    [type],
  )
  const [builderKey, setBuilderKey] = useState<string | null>(null)
  const [builderOperator, setBuilderOperator] = useState<CollectionFilterOperator>('contains')
  const [builderText, setBuilderText] = useState('')
  const builderProperty =
    type.properties.find((property) => property.key === builderKey) ?? filterable[0] ?? null
  const builderOperators = builderProperty === null ? [] : operatorsFor(builderProperty)
  const effectiveOperator = builderOperators.includes(builderOperator)
    ? builderOperator
    : (builderOperators[0] ?? 'is')
  const needsText = effectiveOperator !== 'empty' && effectiveOperator !== 'notEmpty'

  const valuesByProperty = useMemo(() => {
    const inventory = new Map<string, string[]>()
    for (const property of inventoried) {
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
  }, [inventoried, entries])

  if (filterable.length === 0 && filters.length === 0) {
    return null
  }

  const remove = (target: CollectionFilter): void => {
    onChange(
      filters.filter(
        (filter) =>
          !(
            filter.key === target.key &&
            filter.operator === target.operator &&
            filter.text === target.text
          ),
      ),
    )
  }
  const isActive = (key: string, text: string): boolean =>
    filters.some((filter) => filter.key === key && filter.operator === 'is' && filter.text === text)
  const toggleEquality = (key: string, text: string): void => {
    if (isActive(key, text)) {
      remove({ key, operator: 'is', text })
    } else {
      onChange([...filters, { key, operator: 'is', text }])
    }
  }
  const addCondition = (): void => {
    if (builderProperty === null || (needsText && builderText.trim() === '')) {
      return
    }
    onChange([
      ...filters,
      {
        key: builderProperty.key,
        operator: effectiveOperator,
        text: needsText ? builderText.trim() : '',
      },
    ])
    setBuilderText('')
  }

  return (
    <div className="flex items-center gap-1.5">
      {filters.map((filter) => (
        <button
          key={`${filter.key}:${filter.operator}:${filter.text}`}
          type="button"
          onClick={() => remove(filter)}
          className="flex items-center gap-1 rounded-full bg-surface-hover px-2.5 py-1 text-xs text-text-secondary transition-colors hover:text-text"
        >
          <span className="max-w-40 truncate">{filterLabel(type, filter)}</span>
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
        <PopoverContent align="end" sideOffset={6} className="w-72 p-0">
          {builderProperty !== null ? (
            <div className="flex flex-col gap-1.5 border-b border-border p-2">
              <div className="flex gap-1.5">
                <Select
                  value={builderProperty.key}
                  items={Object.fromEntries(
                    filterable.map((property) => [property.key, property.name]),
                  )}
                  onValueChange={(value) => {
                    if (typeof value === 'string') {
                      setBuilderKey(value)
                    }
                  }}
                >
                  <SelectTrigger aria-label="Filter property" data-size="sm" className="flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {filterable.map((property) => (
                      <SelectItem key={property.key} value={property.key}>
                        {property.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={effectiveOperator}
                  items={Object.fromEntries(
                    builderOperators.map((operator) => [operator, OPERATOR_LABELS[operator]]),
                  )}
                  onValueChange={(value) => {
                    if (typeof value === 'string') {
                      setBuilderOperator(value as CollectionFilterOperator)
                    }
                  }}
                >
                  <SelectTrigger aria-label="Filter operator" data-size="sm" className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {builderOperators.map((operator) => (
                      <SelectItem key={operator} value={operator}>
                        {OPERATOR_LABELS[operator]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-1.5">
                {needsText ? (
                  <Input
                    aria-label="Filter value"
                    type={
                      builderProperty.type === 'number'
                        ? 'number'
                        : builderProperty.type === 'date'
                          ? 'date'
                          : 'text'
                    }
                    value={builderText}
                    placeholder="Value"
                    className="h-7 flex-1 text-sm"
                    onChange={(event) => setBuilderText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        addCondition()
                      }
                    }}
                  />
                ) : (
                  <span className="flex-1" />
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  aria-label="Add filter"
                  onClick={addCondition}
                >
                  <Plus aria-hidden className="size-3" /> Add
                </Button>
              </div>
            </div>
          ) : null}
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
                        onSelect={() => toggleEquality(key, text)}
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
