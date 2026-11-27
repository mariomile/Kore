import { isMap, isSeq, parseDocument, type Document, type YAMLMap, type YAMLSeq } from 'yaml'
import type { SavedCollectionViewFilter } from '../tags/tag-views'
import { BaseFileError, type BaseFilter, type BaseSort, type BaseViewDefinition } from './base-file'
import { filterOf, filterToExpression, parseFilterSource } from './simple-filters'

/**
 * Editing a `.base` file's views from Kore's view bar: layout, sort,
 * grouping, filters, columns, and the views themselves (add, rename, move,
 * remove). Every edit goes through the YAML document, so whatever Kore does
 * not touch (formulas, `properties`, plugin options such as `columnOrders`,
 * comments, key order) comes back byte for byte, and the file stays a base
 * Obsidian opens as before. Values are written the way Obsidian writes them
 * (`direction: ASC`, `groupBy: { property, direction }`).
 */

/** How a view's filter-bar rules combine. */
export type BaseFilterMatch = 'all' | 'any'

/** A view's filters as the filter bar shows them. */
export interface BaseViewFilterState {
  /** The simple rules the bar edits. */
  readonly filters: readonly SavedCollectionViewFilter[]
  readonly match: BaseFilterMatch
  /**
   * Rules the bar can't show (a formula, an `or` inside an `and`): kept as
   * they are on every edit, and always required alongside the bar's rules.
   */
  readonly advanced: readonly BaseFilter[]
}

function expressionFilter(filter: BaseFilter): SavedCollectionViewFilter | null {
  return filter.kind === 'expression' ? filterOf(parseFilterSource(filter.source)) : null
}

/** Read a view's own `filters` into the filter bar's rules. */
export function baseViewFilterState(view: BaseViewDefinition): BaseViewFilterState {
  const node = view.filters
  if (node === null) {
    return { filters: [], match: 'all', advanced: [] }
  }
  // `or` of simple rules: the bar's "any" mode.
  if (node.kind === 'or') {
    const simple = node.items.map(expressionFilter)
    if (simple.every((item) => item !== null)) {
      return {
        filters: simple as SavedCollectionViewFilter[],
        match: 'any',
        advanced: [],
      }
    }
    return { filters: [], match: 'all', advanced: [node] }
  }
  const items = node.kind === 'and' ? node.items : node.kind === 'expression' ? [node] : null
  if (items === null) {
    return { filters: [], match: 'all', advanced: [node] }
  }
  const filters: SavedCollectionViewFilter[] = []
  const advanced: BaseFilter[] = []
  let anyGroup: SavedCollectionViewFilter[] | null = null
  for (const item of items) {
    const simple = expressionFilter(item)
    if (simple !== null) {
      filters.push(simple)
      continue
    }
    if (item.kind === 'or') {
      const nested = item.items.map(expressionFilter)
      if (nested.length > 0 && nested.every((entry) => entry !== null)) {
        const rules = nested as SavedCollectionViewFilter[]
        // Equality picks on one property OR together inside "all" (the
        // bar's own rule), written as one `or` per property.
        if (rules.every((rule) => rule.operator === 'is' && rule.key === rules[0]!.key)) {
          filters.push(...rules)
          continue
        }
        // One nested `or` of mixed rules is how the bar writes "any" while
        // keeping advanced rules.
        if (anyGroup === null) {
          anyGroup = rules
          continue
        }
      }
    }
    advanced.push(item)
  }
  if (anyGroup !== null && filters.length === 0) {
    return { filters: anyGroup, match: 'any', advanced }
  }
  if (anyGroup !== null) {
    advanced.push({
      kind: 'or',
      items: anyGroup.map((filter) => ({
        kind: 'expression',
        source: filterToExpression(filter),
      })),
    })
  }
  return { filters, match: 'all', advanced }
}

/** The YAML value of a filter tree node, as `parseBaseFile` reads it back. */
function filterValue(filter: BaseFilter): unknown {
  return filter.kind === 'expression'
    ? filter.source
    : { [filter.kind]: filter.items.map(filterValue) }
}

/** The `filters` value for the bar's rules plus the kept advanced rules, or null for none. */
export function baseViewFiltersValue(state: BaseViewFilterState): unknown {
  const simple = state.filters.map(filterToExpression)
  const advanced = state.advanced.map(filterValue)
  if (state.match === 'any' && simple.length > 0) {
    const anyOf = { or: simple }
    return advanced.length === 0 ? anyOf : { and: [...advanced, anyOf] }
  }
  // "All" ORs the equality picks on one property, as the filter bar does.
  const picks = new Map<string, string[]>()
  const rest: string[] = []
  for (const filter of state.filters) {
    if (filter.operator === 'is') {
      picks.set(filter.key, [...(picks.get(filter.key) ?? []), filterToExpression(filter)])
    } else {
      rest.push(filterToExpression(filter))
    }
  }
  const all = [
    ...advanced,
    ...[...picks.values()].map((sources) => (sources.length === 1 ? sources[0] : { or: sources })),
    ...rest,
  ]
  return all.length === 0 ? null : { and: all }
}

function load(text: string): Document {
  const document = parseDocument(text.trim() === '' ? '{}' : text)
  if (document.errors.length > 0) {
    throw new BaseFileError(document.errors[0]!.message)
  }
  if (!isMap(document.contents)) {
    throw new BaseFileError('a base must be a YAML mapping')
  }
  return document
}

function save(document: Document): string {
  return document.toString({ lineWidth: 0 })
}

/** The `views` sequence, created with one table when the file has none. */
function viewsOf(document: Document): YAMLSeq {
  const views = document.get('views')
  if (isSeq(views)) {
    return views
  }
  const created = document.createNode([{ type: 'table', name: 'Table' }]) as YAMLSeq
  document.set('views', created)
  return created
}

function viewAt(document: Document, index: number): YAMLMap {
  const view = viewsOf(document).get(index)
  if (!isMap(view)) {
    throw new BaseFileError(`the base has no view ${String(index + 1)}`)
  }
  return view
}

/** Set or remove (`null`, `[]`) one key of a view. */
function setKey(document: Document, view: YAMLMap, key: string, value: unknown): void {
  if (value === null || (Array.isArray(value) && value.length === 0)) {
    view.delete(key)
  } else {
    view.set(key, document.createNode(value))
  }
}

function editView(text: string, index: number, edit: (document: Document, view: YAMLMap) => void) {
  const document = load(text)
  edit(document, viewAt(document, index))
  return save(document)
}

/** One change to one view, as the view bar makes it. */
export type BaseViewEdit =
  /** The Obsidian view type: `table`, `cards`, `list`, or `kanban` (Kore's board). */
  | { readonly kind: 'type'; readonly type: string }
  | { readonly kind: 'name'; readonly name: string }
  | { readonly kind: 'sort'; readonly sort: readonly BaseSort[] }
  /** The property to group by (`note.status`), or null for none. */
  | { readonly kind: 'group'; readonly property: string | null }
  | { readonly kind: 'filters'; readonly state: BaseViewFilterState }
  /** The visible columns, as property ids, in order. */
  | { readonly kind: 'columns'; readonly order: readonly string[] }

/** Apply one {@link BaseViewEdit} to view `index` of the base `text`. */
export function editBaseView(text: string, index: number, edit: BaseViewEdit): string {
  return editView(text, index, (document, view) => {
    switch (edit.kind) {
      case 'type':
        view.set('type', edit.type)
        return
      case 'name':
        view.set('name', edit.name)
        return
      case 'sort':
        setKey(
          document,
          view,
          'sort',
          edit.sort.map((sort) => ({
            property: sort.property,
            direction: sort.direction.toUpperCase(),
          })),
        )
        return
      case 'group': {
        const current = view.get('groupBy')
        if (edit.property === null) {
          view.delete('groupBy')
          view.delete('groupOrder')
          return
        }
        // Same property: keep its direction and lane order.
        if (isMap(current) && current.get('property') === edit.property) {
          return
        }
        view.set('groupBy', document.createNode({ property: edit.property, direction: 'ASC' }))
        view.delete('groupOrder')
        return
      }
      case 'filters':
        setKey(document, view, 'filters', baseViewFiltersValue(edit.state))
        return
      case 'columns':
        setKey(document, view, 'order', [...edit.order])
        return
    }
  })
}

/** Append a view; it starts from `from`'s columns, sort and grouping when given. */
export function addBaseView(
  text: string,
  view: {
    readonly type: string
    readonly name: string
    readonly from?: BaseViewDefinition
  },
): string {
  const document = load(text)
  const views = viewsOf(document)
  const from = view.from
  views.add(
    document.createNode({
      type: view.type,
      name: view.name,
      ...(from === undefined || from.order.length === 0 ? {} : { order: [...from.order] }),
      ...(from?.groupBy == null
        ? {}
        : {
            groupBy: {
              property: from.groupBy.property,
              direction: from.groupBy.direction.toUpperCase(),
            },
          }),
      ...(from === undefined || from.sort.length === 0
        ? {}
        : {
            sort: from.sort.map((sort) => ({
              property: sort.property,
              direction: sort.direction.toUpperCase(),
            })),
          }),
    }),
  )
  return save(document)
}

/** Remove view `index`; the last view of a base can't be removed. */
export function removeBaseView(text: string, index: number): string {
  const document = load(text)
  const views = viewsOf(document)
  if (views.items.length <= 1) {
    throw new BaseFileError('a base keeps at least one view')
  }
  views.delete(index)
  return save(document)
}

/** Move view `from` to position `to`. */
export function moveBaseView(text: string, from: number, to: number): string {
  const document = load(text)
  const views = viewsOf(document)
  const [moved] = views.items.splice(from, 1)
  if (moved === undefined) {
    throw new BaseFileError(`the base has no view ${String(from + 1)}`)
  }
  views.items.splice(Math.max(0, Math.min(to, views.items.length)), 0, moved)
  return save(document)
}

/** A view name not taken yet: `Board`, then `Board 2`, `Board 3`… */
export function freeBaseViewName(views: readonly BaseViewDefinition[], wanted: string): string {
  const taken = new Set(views.map((view) => view.name))
  if (!taken.has(wanted)) {
    return wanted
  }
  let suffix = 2
  while (taken.has(`${wanted} ${String(suffix)}`)) {
    suffix += 1
  }
  return `${wanted} ${String(suffix)}`
}
