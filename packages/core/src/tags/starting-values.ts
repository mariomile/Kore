import { parseFrontmatter, splitFrontmatter } from '../markdown'
import type { TagProperty, TagPropertyType, TagType } from './tag-type'
import { localCalendarDate } from './timestamps'

/**
 * Starting values for schema fields (Plan 33 B4). A field's `default` says
 * what a note gets when it joins the tag through Kore: a new row, the Type
 * field, the chat's `set_note_type`, `kore new`/`kore tag`. Editing `#tag`
 * into the Markdown by hand stamps nothing, and a note already in the tag is
 * never touched: there is no gesture to hang the value on, and inventing
 * one for an old note would be a lie (the same rule as `created`).
 *
 * `today` is the local day, `now` the local day and minute, `next-number`
 * one more than the highest number the tag's notes hold in that field (the
 * caller reads it from the index), anything else is a fixed value. A
 * default the field's type can't hold is ignored, never written. A
 * `created` field needs no default: it always starts as `today`, which is
 * all its stamp ever was (Plan 29 T1).
 */

export type StartingValueKind = 'today' | 'now' | 'next-number' | 'fixed'

export const STARTING_VALUE_TODAY = 'today'
export const STARTING_VALUE_NOW = 'now'
export const STARTING_VALUE_NEXT_NUMBER = 'next-number'

/** Which starting values a field of `type` can take, for the editor. */
export function startingValueKinds(type: TagPropertyType): StartingValueKind[] {
  switch (type) {
    case 'date':
      return ['today', 'fixed']
    case 'text':
      return ['today', 'now', 'fixed']
    case 'number':
      return ['next-number', 'fixed']
    case 'rating':
    case 'checkbox':
    case 'select':
    case 'multiselect':
    case 'status':
    case 'url':
    case 'email':
    case 'phone':
      return ['fixed']
    default:
      return []
  }
}

/** The kind a stored `default` names. */
export function startingValueKind(value: string | number | boolean): StartingValueKind {
  if (value === STARTING_VALUE_TODAY) {
    return 'today'
  }
  if (value === STARTING_VALUE_NOW) {
    return 'now'
  }
  if (value === STARTING_VALUE_NEXT_NUMBER) {
    return 'next-number'
  }
  return 'fixed'
}

/** The local day and minute (`YYYY-MM-DD HH:mm`) a `now` value records. */
export function localDateTime(at: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${localCalendarDate(at)} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

const CALENDAR_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** A fixed default as the value the field's type stores, or `undefined`. */
function fixedValue(
  property: TagProperty,
  value: string | number | boolean,
): FixedValue | undefined {
  switch (property.type) {
    case 'number':
    case 'rating': {
      const number = typeof value === 'number' ? value : Number(String(value).trim())
      return typeof value !== 'boolean' && String(value).trim() !== '' && Number.isFinite(number)
        ? number
        : undefined
    }
    case 'checkbox':
      if (typeof value === 'boolean') {
        return value
      }
      return value === 'true' ? true : value === 'false' ? false : undefined
    case 'date':
      return typeof value === 'string' && CALENDAR_DATE_RE.test(value) ? value : undefined
    case 'select':
    case 'status':
      return typeof value === 'string' && (property.options ?? []).includes(value)
        ? value
        : undefined
    case 'multiselect':
      return typeof value === 'string' && (property.options ?? []).includes(value)
        ? [value]
        : undefined
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return typeof value === 'string' ? value : String(value)
    default:
      return undefined
  }
}

/** What the caller already knows when it stamps. */
export interface StartingValueContext {
  /** When the note joins; `today`/`now` read it. */
  at?: Date
  /**
   * The next free number per field key for `next-number` fields, from the
   * index (`nextNumbers`). A field missing here gets no value.
   */
  nextNumbers?: ReadonlyMap<string, number>
}

/** A fixed starting value in the form the field's type stores it. */
export type FixedValue = string | number | boolean | string[]

/**
 * A field's starting value once validated: the one decision the app, the
 * index and the CLI share. The inheritance pass stores it on every stored
 * property as `start` (`refreshTagTypeResolutions`), so `kore` only
 * materializes it and never re-validates.
 */
export type StartingValue =
  | { kind: 'today' }
  | { kind: 'now' }
  | { kind: 'next-number' }
  | { kind: 'fixed'; value: FixedValue }

/** Option-typed fields, whose fixed value must be one of the options. */
function hasOptions(property: TagProperty): boolean {
  return property.type === 'select' || property.type === 'multiselect' || property.type === 'status'
}

/**
 * What `property`'s `default` means, or `null` when it declares none or one
 * its type can't hold. For an option field an option wins over a keyword,
 * so an option literally named `today` is a fixed value, not a date.
 */
export function startingValueOf(property: TagProperty): StartingValue | null {
  if (property.type === 'created') {
    return { kind: 'today' }
  }
  const declared = property.default
  if (declared === undefined) {
    return null
  }
  if (hasOptions(property)) {
    const value = fixedValue(property, declared)
    return value === undefined ? null : { kind: 'fixed', value }
  }
  const kind = startingValueKind(declared)
  if (!startingValueKinds(property.type).includes(kind)) {
    return null
  }
  if (kind !== 'fixed') {
    return { kind }
  }
  const value = fixedValue(property, declared)
  return value === undefined ? null : { kind: 'fixed', value }
}

/**
 * The value `property` starts with now, or `undefined` when it declares
 * none (or one its type can't hold, or a `next-number` nobody read).
 */
export function propertyStartingValue(
  property: TagProperty,
  context: StartingValueContext = {},
): FixedValue | undefined {
  const start = startingValueOf(property)
  const at = context.at ?? new Date()
  switch (start?.kind) {
    case undefined:
      return undefined
    case 'today':
      return localCalendarDate(at)
    case 'now':
      return localDateTime(at)
    case 'next-number':
      return context.nextNumbers?.get(property.key)
    case 'fixed':
      return start.value
  }
}

/**
 * A stored type with each property's validated starting value under
 * `start`, for the index columns the CLI reads. TypeScript readers drop the
 * key on decode and call {@link startingValueOf} again: same function, so
 * the two sides cannot drift.
 */
export function withStoredStartingValues(type: TagType): TagType {
  return {
    ...type,
    properties: type.properties.map((property) => {
      const start = startingValueOf(property)
      return start === null ? property : { ...property, start }
    }),
  }
}

/** The keys of the `next-number` fields, which need the index to stamp. */
export function nextNumberKeys(type: TagType | null | undefined): string[] {
  return (type?.properties ?? [])
    .filter((property) => startingValueOf(property)?.kind === 'next-number')
    .map((property) => property.key)
}

/**
 * Every value a note joining the tag now starts with, `created` stamps
 * included. Callers spread these *under* their own values, so a value the
 * caller already knows (a board lane, a CSV cell) wins.
 */
export function startingValues(
  type: TagType | null | undefined,
  context: StartingValueContext = {},
): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const property of type?.properties ?? []) {
    const value = propertyStartingValue(property, context)
    if (value !== undefined) {
      values[property.key] = value
    }
  }
  return values
}

/**
 * The `values` a note does not already carry, for a membership the app
 * writes on an existing note (the Type field, the chat). A key already in
 * the frontmatter is left alone: the note's own value is the truth, and a
 * second tagging must not move it.
 */
export function valuesMissingFrom(
  source: string,
  values: Record<string, unknown>,
): Record<string, unknown> {
  if (Object.keys(values).length === 0) {
    return {}
  }
  const present: Record<string, unknown> = parseFrontmatter(splitFrontmatter(source).raw).data
  return Object.fromEntries(Object.entries(values).filter(([key]) => present[key] === undefined))
}
