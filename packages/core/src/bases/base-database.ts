import type { CollectionEntry, CollectionSort } from '../indexing/collections'
import { TITLE_SORT_KEY, UPDATED_SORT_KEY } from '../indexing/collections'
import type { CollectionPageView } from '../tags/tag-views'
import type { TagProperty, TagType } from '../tags/tag-type'
import type { BaseDefinition, BaseSort, BaseViewDefinition } from './base-file'
import { baseViewFilterState, type BaseViewFilterState } from './base-file-edit'
import { baseFieldSet, type BaseField } from './base-fields'
import { basePropertyValue } from './evaluate'
import { runBaseView, type BaseVault } from './run-view'
import type { BaseNewNotePrefill } from './new-note'
import { baseValueText, type BaseValue } from './values'

/**
 * A base seen as a database, the way a type's page shows one: its notes as
 * collection rows (formula cells filled in), its fields as a schema, and
 * each view as a layout, a sort chain, a grouping, filter-bar rules and
 * visible columns. The rows a view lists, and their order, come from the
 * base engine itself (`runBaseView`), so Kore lists exactly what Obsidian
 * lists; the view bar only reads and writes the view's settings, through
 * `base-file-edit.ts`.
 */

/** The layouts a base view can take in Kore, and the Obsidian type each writes. */
export const BASE_VIEW_TYPES: Readonly<Record<'table' | 'board' | 'grid', string>> = {
  table: 'table',
  board: 'kanban',
  grid: 'cards',
}

/** The page layouts a base offers when adding a view. */
export const BASE_ADDABLE_VIEWS: readonly CollectionPageView[] = ['table', 'board', 'grid']

/** One base view as the database page shows it. */
export interface BaseDatabaseView {
  readonly index: number
  readonly name: string
  readonly layout: CollectionPageView
  /** The sort chain as collection sorts (`$title`, `$updated`, property keys). */
  readonly sorts: readonly CollectionSort[]
  /** The grouping property key, or null. */
  readonly group: string | null
  readonly filters: BaseViewFilterState
  /** Visible property keys, in column order (the title always shows). */
  readonly columns: readonly string[]
  /** The view's rows, filtered and sorted by the base engine. */
  readonly entries: readonly CollectionEntry[]
  /** What a note created from this view starts with. */
  readonly newNote: BaseNewNotePrefill
}

/** A base as a database: schema, every row, the fields, and one view. */
export interface BaseDatabase {
  /** Every field the view bar can show: note properties, then formulas. */
  readonly type: TagType
  /** Keys a cell may edit (note properties; never formulas). */
  readonly editableKeys: ReadonlySet<string>
  /** The base's notes (its own filters only): the filter menu's value inventory. */
  readonly entries: readonly CollectionEntry[]
  readonly fields: readonly BaseField[]
  readonly view: BaseDatabaseView
}

/** The page layout for a base view type (`list` reads as a table). */
export function baseViewLayout(view: BaseViewDefinition): CollectionPageView {
  switch (view.type.toLowerCase()) {
    case 'cards':
    case 'masonry':
    case 'gallery':
      return 'grid'
    case 'kanban':
    case 'board':
      return view.groupBy === null ? 'grid' : 'board'
    default:
      return 'table'
  }
}

/** A property id as the page keys it: `note.x`/`x` → `x`, `formula.x` stays, file ids → null. */
export function baseFieldPageKey(id: string): string | null {
  if (id.startsWith('formula.')) {
    return id
  }
  if (/^(?:file|this)\./.test(id)) {
    return null
  }
  return id.startsWith('note.') ? id.slice('note.'.length) : id
}

function sortKeyOf(id: string): string | null {
  if (id === 'file.name' || id === 'file.basename') {
    return TITLE_SORT_KEY
  }
  if (id === 'file.mtime') {
    return UPDATED_SORT_KEY
  }
  return baseFieldPageKey(id)
}

/** The base property id a page sort or group key writes back (`$title` → `file.name`). */
export function basePropertyIdOf(key: string): string {
  if (key === TITLE_SORT_KEY) {
    return 'file.name'
  }
  if (key === UPDATED_SORT_KEY) {
    return 'file.mtime'
  }
  return key
}

/** The base sort chain for a page sort chain. */
export function baseSortOf(sorts: readonly CollectionSort[]): BaseSort[] {
  return sorts.map((sort) => ({
    property: basePropertyIdOf(sort.key),
    direction: sort.direction,
  }))
}

/**
 * The view's `order` after showing or hiding `key`: file columns and the
 * other columns keep their places; a shown column joins at the end.
 */
export function baseColumnsToggled(view: BaseViewDefinition, key: string): string[] {
  const shown = view.order.some((id) => baseFieldPageKey(id) === key)
  return shown ? view.order.filter((id) => baseFieldPageKey(id) !== key) : [...view.order, key]
}

/** Read `definition` as a database showing view `viewIndex`. */
export function baseDatabase(
  definition: BaseDefinition,
  viewIndex: number,
  vault: BaseVault,
  now: number,
): BaseDatabase {
  const fieldSet = baseFieldSet(definition, vault, now)
  const definitionView = definition.views[viewIndex] ?? definition.views[0]!
  const index = definition.views.indexOf(definitionView)
  // A grouping's lane order (`groupOrder`) becomes the field's options, so
  // the board's lanes come in the order the base sets.
  // A field some view groups by is a pick list, whatever its values look like.
  const laneOrders = new Map<string, readonly string[]>()
  for (const view of definition.views) {
    const key = view.groupBy === null ? null : baseFieldPageKey(view.groupBy.property)
    if (key !== null && (!laneOrders.has(key) || laneOrders.get(key)!.length === 0)) {
      laneOrders.set(
        key,
        view.groupBy!.order.filter((option) => option !== '' && option !== 'null'),
      )
    }
  }
  const formulas = Object.keys(definition.formulas)
  const properties: TagProperty[] = [
    ...fieldSet.type.properties.map((property): TagProperty => {
      const order = laneOrders.get(property.key)
      if (order === undefined || (property.type !== 'select' && property.type !== 'text')) {
        return property
      }
      const options = new Set(order)
      for (const entry of fieldSet.entries) {
        const value = entry.properties[property.key]
        if (value?.valueType === 'string' && value.value !== '') {
          options.add(value.value)
        }
      }
      return { ...property, type: 'select', options: [...options] }
    }),
    ...formulas.map(
      (name): TagProperty => ({
        key: `formula.${name}`,
        name: definition.displayNames[`formula.${name}`] ?? name,
        type: 'text',
      }),
    ),
  ]
  // Formula cells, computed once per note for every view.
  const byPath = new Map(vault.rows.map((row) => [row.path, row]))
  const entries: CollectionEntry[] = fieldSet.entries.map((entry) => {
    if (formulas.length === 0) {
      return entry
    }
    const row = byPath.get(entry.path)!
    const context = {
      row,
      now,
      formulas: definition.formulas,
      titleOf: vault.titleOf,
      resolve: vault.resolve,
    }
    const cache = new Map<string, BaseValue>()
    const values = { ...entry.properties }
    for (const name of formulas) {
      let text = ''
      try {
        text = baseValueText(basePropertyValue(`formula.${name}`, context, cache))
      } catch {
        text = ''
      }
      if (text !== '') {
        values[`formula.${name}`] = {
          value: text,
          valueType: 'string',
          valueNumber: null,
        }
      }
    }
    return { ...entry, properties: values }
  })
  const entryByPath = new Map(entries.map((entry) => [entry.path, entry]))
  const result = runBaseView(definition, index, vault, now)
  const known = new Set(properties.map((property) => property.key))
  return {
    type: { properties },
    editableKeys: new Set(fieldSet.type.properties.map((property) => property.key)),
    entries,
    fields: fieldSet.fields,
    view: {
      index,
      name: definitionView.name,
      layout: baseViewLayout(definitionView),
      sorts: definitionView.sort.flatMap((sort) => {
        const key = sortKeyOf(sort.property)
        return key === null ? [] : [{ key, direction: sort.direction }]
      }),
      group:
        definitionView.groupBy === null ? null : baseFieldPageKey(definitionView.groupBy.property),
      filters: baseViewFilterState(definitionView),
      columns: definitionView.order
        .map(baseFieldPageKey)
        .filter((key): key is string => key !== null && known.has(key)),
      entries: result.rows.flatMap((row) => {
        const entry = entryByPath.get(row.path)
        return entry === undefined ? [] : [entry]
      }),
      newNote: result.newNote,
    },
  }
}
