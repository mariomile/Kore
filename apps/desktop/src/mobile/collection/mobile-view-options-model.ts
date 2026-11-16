import { TITLE_SORT_KEY, UPDATED_SORT_KEY, type CollectionSort, type TagType } from '@kore/core'
import type { CollectionFilter } from '@/components/all-notes/collection-filter-menu'

/** One field a collection can sort by: the title, a property, or the edit time. */
export interface SortField {
  key: string
  name: string
}

/**
 * Everything the Sort page offers, in table order: Title, the schema's
 * fields, then Updated. A schema's own `updated` field already sorts by the
 * edit time, so the built-in Updated joins only when the schema has none.
 */
export function sortFields(type: TagType): SortField[] {
  const fields: SortField[] = [{ key: TITLE_SORT_KEY, name: 'Title' }]
  for (const property of type.properties) {
    fields.push({ key: property.key, name: property.name })
  }
  if (!type.properties.some((property) => property.type === 'updated')) {
    fields.push({ key: UPDATED_SORT_KEY, name: 'Updated' })
  }
  return fields
}

/** The name a sort key reads as; a key the schema dropped shows as itself. */
export function sortFieldName(type: TagType, key: string): string {
  return sortFields(type).find((field) => field.key === key)?.name ?? key
}

/** The root row's summary: "None", "Due ↑", or "Due ↑ +1". */
export function sortSummary(type: TagType, sorts: readonly CollectionSort[]): string {
  const [first, ...rest] = sorts
  if (first === undefined) {
    return 'None'
  }
  const head = `${sortFieldName(type, first.key)} ${first.direction === 'asc' ? '↑' : '↓'}`
  return rest.length === 0 ? head : `${head} +${rest.length}`
}

/** The chain with `key` appended ascending (a key already in it stays put). */
export function addSort(sorts: readonly CollectionSort[], key: string): CollectionSort[] {
  if (sorts.some((sort) => sort.key === key)) {
    return [...sorts]
  }
  return [...sorts, { key, direction: 'asc' }]
}

/** The chain with `key`'s direction flipped. */
export function flipSort(sorts: readonly CollectionSort[], key: string): CollectionSort[] {
  return sorts.map((sort) =>
    sort.key === key ? { key, direction: sort.direction === 'asc' ? 'desc' : 'asc' } : sort,
  )
}

/** The chain without `key`. */
export function removeSort(sorts: readonly CollectionSort[], key: string): CollectionSort[] {
  return sorts.filter((sort) => sort.key !== key)
}

function sameFilter(left: CollectionFilter, right: CollectionFilter): boolean {
  return left.key === right.key && left.operator === right.operator && left.text === right.text
}

/** Whether exactly this condition is active. */
export function hasFilter(filters: readonly CollectionFilter[], filter: CollectionFilter): boolean {
  return filters.some((entry) => sameFilter(entry, filter))
}

/** Adds the condition, or drops it when it is already active (a tap toggles). */
export function toggleFilter(
  filters: readonly CollectionFilter[],
  filter: CollectionFilter,
): CollectionFilter[] {
  return hasFilter(filters, filter)
    ? filters.filter((entry) => !sameFilter(entry, filter))
    : [...filters, filter]
}

/** How many conditions sit on one field (the field row's count). */
export function filterCountFor(filters: readonly CollectionFilter[], key: string): number {
  return filters.filter((filter) => filter.key === key).length
}

/** The Fields row's summary: "All", or "3 of 5". */
export function fieldsSummary(type: TagType, hidden: ReadonlySet<string>): string {
  const total = type.properties.length
  const shown = type.properties.filter((property) => !hidden.has(property.key)).length
  return shown === total ? 'All' : `${shown} of ${total}`
}
