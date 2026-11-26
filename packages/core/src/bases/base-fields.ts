import type { CollectionEntry, CollectionValue } from '../indexing/collections'
import { RESERVED_FRONTMATTER_KEYS, type TagProperty, type TagType } from '../tags/tag-type'
import type { BaseDefinition } from './base-file'
import { parseBaseDate } from './dates'
import { baseFilterMatches, type BaseVault } from './run-view'
import type { BaseNoteRow, BasePropertyValue } from './values'

/**
 * The fields a base's view bar offers (columns to show, properties to group,
 * sort and filter by): the frontmatter keys its notes actually carry, its
 * formulas, and the file's name and dates. A base declares no schema, so a
 * field's kind is read from the values: all booleans make a checkbox, all
 * numbers a number, all dates a date, lists a multi-select, and text that
 * repeats a select (Obsidian's `status: to-apply` reads as the pick list it is).
 * The bar then hands the note fields to the same filter and group menus a
 * type's page uses, shaped as a schema and its rows.
 */

/** One field a base's view bar can show, sort, group or filter by. */
export interface BaseField {
  /** Property id as a base writes it: `note.status`, `formula.days`, `file.name`. */
  readonly id: string
  /** The frontmatter key a note field reads, or null for formulas and file fields. */
  readonly key: string | null
  readonly label: string
  readonly type: TagProperty['type']
}

/** The fields and member rows of one base, ready for the view bar. */
export interface BaseFieldSet {
  readonly fields: readonly BaseField[]
  /** The note fields as a schema, for the filter and group menus. */
  readonly type: TagType
  /** The notes the base's own filters keep, as collection rows. */
  readonly entries: readonly CollectionEntry[]
}

const FILE_FIELDS: readonly BaseField[] = [
  { id: 'file.name', key: null, label: 'Name', type: 'text' },
  { id: 'file.mtime', key: null, label: 'Modified', type: 'updated' },
  { id: 'file.ctime', key: null, label: 'Created', type: 'created' },
  { id: 'file.folder', key: null, label: 'Folder', type: 'text' },
  { id: 'file.tags', key: null, label: 'Tags', type: 'multiselect' },
]

/** Distinct values at or under which repeated text reads as a pick list. */
const SELECT_MAX_OPTIONS = 24

/** The notes the base's own (global) filters keep, before any view's. */
export function baseMembers(
  definition: BaseDefinition,
  vault: BaseVault,
  now: number,
): BaseNoteRow[] {
  return vault.rows.filter((row) =>
    baseFilterMatches(
      definition.filters,
      {
        row,
        now,
        formulas: definition.formulas,
        titleOf: vault.titleOf,
        resolve: vault.resolve,
      },
      new Map(),
    ),
  )
}

function kindOf(values: readonly BasePropertyValue[]): TagProperty['type'] {
  const present = values.filter((value) => value !== null && value !== '')
  if (present.length === 0) {
    return 'text'
  }
  if (present.every((value) => typeof value === 'boolean')) {
    return 'checkbox'
  }
  if (present.every((value) => typeof value === 'number')) {
    return 'number'
  }
  if (present.some((value) => Array.isArray(value))) {
    return 'multiselect'
  }
  const texts = present.map(String)
  if (texts.every((text) => parseBaseDate(text) !== null)) {
    return 'date'
  }
  if (texts.some((text) => text.includes('[[') || /^https?:\/\//.test(text))) {
    return 'text'
  }
  const distinct = new Set(texts)
  return distinct.size <= SELECT_MAX_OPTIONS && distinct.size < texts.length ? 'select' : 'text'
}

function label(definition: BaseDefinition, id: string, fallback: string): string {
  return definition.displayNames[id] ?? definition.displayNames[fallback] ?? fallback
}

function collectionValue(value: BasePropertyValue): CollectionValue | null {
  if (value === null) {
    return null
  }
  if (typeof value === 'number') {
    return { value: String(value), valueType: 'number', valueNumber: value }
  }
  if (typeof value === 'boolean') {
    return { value: String(value), valueType: 'boolean', valueNumber: null }
  }
  if (typeof value === 'string') {
    return { value, valueType: 'string', valueNumber: null }
  }
  return { value: JSON.stringify(value), valueType: 'list', valueNumber: null }
}

/** The view bar's fields for a base, its note fields as a schema, and its member rows. */
export function baseFieldSet(
  definition: BaseDefinition,
  vault: BaseVault,
  now: number,
): BaseFieldSet {
  const members = baseMembers(definition, vault, now)
  const valuesByKey = new Map<string, BasePropertyValue[]>()
  for (const row of members) {
    for (const [key, value] of Object.entries(row.properties)) {
      if (RESERVED_FRONTMATTER_KEYS.has(key) || key === 'tags') {
        continue
      }
      const values = valuesByKey.get(key) ?? []
      values.push(value)
      valuesByKey.set(key, values)
    }
  }
  const noteFields: BaseField[] = [...valuesByKey]
    .map(([key, values]) => ({
      id: `note.${key}`,
      key,
      label: label(definition, `note.${key}`, key),
      type: kindOf(values),
    }))
    .sort((left, right) => left.label.localeCompare(right.label))
  const formulaFields: BaseField[] = Object.keys(definition.formulas).map((name) => ({
    id: `formula.${name}`,
    key: null,
    label: label(definition, `formula.${name}`, name),
    type: 'formula',
  }))
  const properties: TagProperty[] = noteFields.map((field) => ({
    key: field.key!,
    name: field.label,
    type: field.type,
  }))
  const entries: CollectionEntry[] = members.map((row) => {
    const values: Record<string, CollectionValue> = {}
    for (const field of noteFields) {
      const value = collectionValue(row.properties[field.key!] ?? null)
      if (value !== null) {
        values[field.key!] = value
      }
    }
    return {
      path: row.path,
      title: row.title,
      mtime: row.mtime,
      isPinned: false,
      properties: values,
    }
  })
  return {
    fields: [FILE_FIELDS[0]!, ...noteFields, ...formulaFields, ...FILE_FIELDS.slice(1)],
    type: { properties },
    entries,
  }
}
