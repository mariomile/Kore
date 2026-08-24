import type { IndexedPropertyValueType } from './properties'
import { relationTarget, type RollupAggregation } from './tag-type'

/** Indexed cell shape these helpers read — structural, not the collections type. */
export interface PropertyValue {
  value: string
  valueType: IndexedPropertyValueType
  valueNumber: number | null
}

/**
 * Display/parse helpers for the extra property types (status, files, email,
 * rating) and view-only rollups. Storage stays generic scalars/lists; typing
 * is the schema's job at display time.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** True when `value` looks like a single email address. */
export function isEmailValue(value: string): boolean {
  return EMAIL_RE.test(value.trim())
}

/** Integer 1–5, or `null` when the stored value isn't a rating. */
export function parseRating(value: number): number | null {
  if (!Number.isSafeInteger(value) || value < 1 || value > 5) {
    return null
  }
  return value
}

/** Compact star face for a 1–5 rating (`★★★☆☆`). */
export function formatRating(value: number): string {
  const rating = parseRating(value)
  if (rating === null) {
    return String(value)
  }
  return `${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}`
}

/** Filename of a stored asset path (`assets/scan.pdf` → `scan.pdf`). */
export function fileBasename(path: string): string {
  const trimmed = path.trim().replaceAll('\\', '/')
  const slash = trimmed.lastIndexOf('/')
  return slash === -1 ? trimmed : trimmed.slice(slash + 1)
}

/** Decode a `list` PropertyValue into strings, or `null` when malformed. */
export function decodePropertyList(value: PropertyValue): string[] | null {
  if (value.valueType !== 'list') {
    return null
  }
  try {
    const entries = JSON.parse(value.value) as unknown
    return Array.isArray(entries) ? entries.map(String) : null
  } catch {
    return null
  }
}

/** Wiki-link targets (or raw strings) stored on a relation / relations cell. */
export function extractRelationTargets(value: PropertyValue | undefined): string[] {
  if (value === undefined) {
    return []
  }
  if (value.valueType === 'list') {
    const entries = decodePropertyList(value)
    if (entries === null) {
      return []
    }
    return entries
      .map((entry) => relationTarget(entry) ?? entry.trim())
      .filter((entry) => entry !== '')
  }
  const trimmed = value.value.trim()
  if (trimmed === '') {
    return []
  }
  return [relationTarget(trimmed) ?? trimmed]
}

/** One related note's value, flattened for rollup aggregation. */
export interface RollupSourceValue {
  empty: boolean
  text: string
  number: number | null
}

function sourceFromValue(value: PropertyValue | undefined): RollupSourceValue {
  if (value === undefined) {
    return { empty: true, text: '', number: null }
  }
  if (value.valueType === 'list') {
    const entries = decodePropertyList(value)
    if (entries === null || entries.length === 0) {
      return { empty: true, text: value.value, number: null }
    }
    return { empty: false, text: entries.join(', '), number: null }
  }
  if (value.valueType === 'boolean') {
    return { empty: false, text: value.value, number: null }
  }
  if (value.valueType === 'number') {
    return {
      empty: false,
      text: value.value,
      number: value.valueNumber,
    }
  }
  return { empty: value.value.trim() === '', text: value.value, number: null }
}

export interface RollupResult {
  text: string
  number: number | null
}

/** Aggregate related-note values. Never writes — display only. */
export function computeRollup(
  aggregation: RollupAggregation,
  sources: readonly RollupSourceValue[],
): RollupResult {
  switch (aggregation) {
    case 'count':
      return { text: String(sources.length), number: sources.length }
    case 'empty': {
      const n = sources.filter((source) => source.empty).length
      return { text: String(n), number: n }
    }
    case 'original': {
      const first = sources.find((source) => !source.empty)
      return first === undefined
        ? { text: '', number: null }
        : { text: first.text, number: first.number }
    }
    case 'unique': {
      const unique: string[] = []
      const seen = new Set<string>()
      for (const source of sources) {
        if (source.empty || seen.has(source.text)) {
          continue
        }
        seen.add(source.text)
        unique.push(source.text)
      }
      return { text: unique.join(', '), number: unique.length }
    }
  }
}

/** Flatten one related note's property into a rollup source. */
export function rollupSourceFromValue(value: PropertyValue | undefined): RollupSourceValue {
  return sourceFromValue(value)
}
