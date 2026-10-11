import { parse as parseYaml } from 'yaml'
import { z } from 'zod'

/**
 * The `.base` file format of Obsidian Bases: YAML with a global `filters`
 * tree, named `formulas`, per-property `displayName`s and a list of `views`.
 * Kore reads it as is and never writes it, so the file stays Obsidian's.
 *
 * Parsing is lenient: unknown keys (plugin view options, `columnSize`,
 * `image`) are ignored, and a malformed view or filter node is skipped
 * rather than failing the whole base.
 */

/** A filter tree node: an expression, or `and` / `or` / `not` over nodes. */
export type BaseFilter =
  | { readonly kind: 'expression'; readonly source: string }
  | { readonly kind: 'and' | 'or' | 'not'; readonly items: readonly BaseFilter[] }

export interface BaseSort {
  /** Property id: `file.mtime`, `note.status`, `formula.age`, or bare `status`. */
  readonly property: string
  readonly direction: 'asc' | 'desc'
}

export interface BaseGroupBy extends BaseSort {
  /** Explicit column order (kanban plugins' `groupOrder`), when given. */
  readonly order: readonly string[]
}

export interface BaseViewDefinition {
  /** Obsidian view type (`table`, `cards`, `list`, or a plugin's `kanban`, `masonry`…). */
  readonly type: string
  readonly name: string
  readonly filters: BaseFilter | null
  /** Columns, as property ids, in display order. */
  readonly order: readonly string[]
  readonly sort: readonly BaseSort[]
  readonly limit: number | null
  readonly groupBy: BaseGroupBy | null
}

export interface BaseDefinition {
  readonly filters: BaseFilter | null
  readonly formulas: Readonly<Record<string, string>>
  /** Column labels from `properties.<id>.displayName`. */
  readonly displayNames: Readonly<Record<string, string>>
  readonly views: readonly BaseViewDefinition[]
}

/** A `.base` file that is not YAML, or not an object at the top. */
export class BaseFileError extends Error {}

const looseRecord = z.record(z.string(), z.unknown())

function parseFilter(node: unknown): BaseFilter | null {
  if (typeof node === 'string') {
    return node.trim() === '' ? null : { kind: 'expression', source: node }
  }
  if (typeof node === 'boolean' || typeof node === 'number') {
    return { kind: 'expression', source: String(node) }
  }
  const record = looseRecord.safeParse(node)
  if (!record.success) {
    return null
  }
  for (const kind of ['and', 'or', 'not'] as const) {
    const items = record.data[kind]
    if (Array.isArray(items)) {
      return {
        kind,
        items: items.map(parseFilter).filter((item): item is BaseFilter => item !== null),
      }
    }
  }
  return null
}

function direction(value: unknown): 'asc' | 'desc' {
  return typeof value === 'string' && value.toLowerCase() === 'desc' ? 'desc' : 'asc'
}

function parseSort(node: unknown): BaseSort | null {
  const record = looseRecord.safeParse(node)
  if (!record.success || typeof record.data.property !== 'string') {
    return null
  }
  return { property: record.data.property, direction: direction(record.data.direction) }
}

function stringList(node: unknown): string[] {
  return Array.isArray(node) ? node.filter((item): item is string => typeof item === 'string') : []
}

function parseView(node: unknown, index: number): BaseViewDefinition | null {
  const record = looseRecord.safeParse(node)
  if (!record.success) {
    return null
  }
  const view = record.data
  const groupBy = parseSort(view.groupBy)
  const limit = typeof view.limit === 'number' && view.limit > 0 ? Math.floor(view.limit) : null
  return {
    type: typeof view.type === 'string' ? view.type : 'table',
    name:
      typeof view.name === 'string' && view.name.trim() !== '' ? view.name : `View ${index + 1}`,
    filters: parseFilter(view.filters),
    order: stringList(view.order),
    sort: Array.isArray(view.sort)
      ? view.sort.map(parseSort).filter((sort): sort is BaseSort => sort !== null)
      : [],
    limit,
    groupBy:
      groupBy === null ? null : { ...groupBy, order: stringList(view.groupOrder).map(String) },
  }
}

/**
 * Parse the text of a `.base` file.
 *
 * @throws {BaseFileError} when the text is not a YAML mapping.
 */
export function parseBaseFile(text: string): BaseDefinition {
  let document: unknown
  try {
    document = text.trim() === '' ? {} : parseYaml(text)
  } catch (error) {
    throw new BaseFileError(error instanceof Error ? error.message : 'not valid YAML')
  }
  const root = looseRecord.safeParse(document ?? {})
  if (!root.success) {
    throw new BaseFileError('a base must be a YAML mapping')
  }
  const formulas: Record<string, string> = {}
  const formulaNode = looseRecord.safeParse(root.data.formulas)
  if (formulaNode.success) {
    for (const [name, source] of Object.entries(formulaNode.data)) {
      if (typeof source === 'string' || typeof source === 'number') {
        formulas[name] = String(source)
      }
    }
  }
  const displayNames: Record<string, string> = {}
  const propertyNode = looseRecord.safeParse(root.data.properties)
  if (propertyNode.success) {
    for (const [id, options] of Object.entries(propertyNode.data)) {
      const record = looseRecord.safeParse(options)
      if (record.success && typeof record.data.displayName === 'string') {
        displayNames[id] = record.data.displayName
      }
    }
  }
  const views = Array.isArray(root.data.views)
    ? root.data.views.map(parseView).filter((view): view is BaseViewDefinition => view !== null)
    : []
  return {
    filters: parseFilter(root.data.filters),
    formulas,
    displayNames,
    views:
      views.length > 0
        ? views
        : [
            {
              type: 'table',
              name: 'Table',
              filters: null,
              order: [],
              sort: [],
              limit: null,
              groupBy: null,
            },
          ],
  }
}
