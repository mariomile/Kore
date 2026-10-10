import type { BaseDefinition, BaseFilter, BaseViewDefinition } from './base-file'
import { basePropertyValue, evaluateBaseExpression } from './evaluate'
import {
  baseValueText,
  compareBaseValues,
  isTruthy,
  type BaseEvaluationContext,
  type BaseNoteRow,
  type BaseValue,
} from './values'

/**
 * Run one view of a base over the vault's notes: global and view filters,
 * formulas, sort, limit and grouping, down to display-ready cells. Pure, so
 * the same rows can feed a full Base screen and every embed of it.
 */

/** How Kore lays a view out. Plugin view types map onto the nearest one. */
export type BaseLayout = 'table' | 'cards' | 'list' | 'board'

export interface BaseColumn {
  /** Property id as written in the base (`file.name`, `formula.age`, `status`). */
  readonly id: string
  readonly label: string
}

/** A note a cell links to. */
export interface BaseCellLink {
  readonly path: string
  readonly title: string
}

export interface BaseCell {
  readonly text: string
  /** Notes the value points at (`file.name`, links, backlinks); may be empty. */
  readonly links: readonly BaseCellLink[]
  /** Set when the value failed to evaluate; `text` is empty then. */
  readonly error: string | null
}

export interface BaseResultRow {
  readonly path: string
  readonly title: string
  /** One cell per {@link BaseViewResult.columns} entry. */
  readonly cells: readonly BaseCell[]
}

export interface BaseResultGroup {
  /** Grouping value as text; `''` for notes without one. */
  readonly key: string
  readonly rows: readonly BaseResultRow[]
}

export interface BaseViewResult {
  readonly name: string
  /** The view type as written (`table`, `kanban`, `masonry`…). */
  readonly type: string
  readonly layout: BaseLayout
  /** True when `type` is a plugin view Kore shows in a stand-in layout. */
  readonly approximated: boolean
  readonly columns: readonly BaseColumn[]
  /** Matching notes after sort and limit. */
  readonly rows: readonly BaseResultRow[]
  /** Set when the view groups (`groupBy`), in display order. */
  readonly groups: readonly BaseResultGroup[] | null
  /** Matching notes before `limit`. */
  readonly total: number
}

const NATIVE_LAYOUTS: Record<string, BaseLayout> = {
  table: 'table',
  cards: 'cards',
  list: 'list',
}
const PLUGIN_LAYOUTS: Record<string, BaseLayout> = {
  masonry: 'cards',
  gallery: 'cards',
  kanban: 'board',
  board: 'board',
}

const DEFAULT_LABELS: Record<string, string> = {
  'file.name': 'Name',
  'file.basename': 'Name',
  'file.path': 'Path',
  'file.folder': 'Folder',
  'file.ext': 'Extension',
  'file.size': 'Size',
  'file.ctime': 'Created',
  'file.mtime': 'Modified',
  'file.tags': 'Tags',
  'file.links': 'Links',
  'file.backlinks': 'Backlinks',
}

function columnLabel(id: string, definition: BaseDefinition): string {
  const bare = id.replace(/^note\./, '')
  return (
    definition.displayNames[id] ??
    definition.displayNames[`note.${bare}`] ??
    definition.displayNames[bare] ??
    DEFAULT_LABELS[id] ??
    id.replace(/^(?:note|formula|file)\./, '')
  )
}

function layoutFor(view: BaseViewDefinition): { layout: BaseLayout; approximated: boolean } {
  const type = view.type.toLowerCase()
  const native = NATIVE_LAYOUTS[type]
  if (native !== undefined) {
    return { layout: native, approximated: false }
  }
  const plugin = PLUGIN_LAYOUTS[type]
  if (plugin === 'board' && view.groupBy === null) {
    return { layout: 'cards', approximated: true }
  }
  return { layout: plugin ?? 'table', approximated: true }
}

/** Shared lookups every row's evaluation needs. */
export interface BaseVault {
  readonly rows: readonly BaseNoteRow[]
  readonly titleOf: (path: string) => string
  readonly resolve: (target: string) => string | null
}

/** Index rows for evaluation: titles by path and link-target resolution. */
export function createBaseVault(rows: readonly BaseNoteRow[]): BaseVault {
  const byPath = new Map(rows.map((row) => [row.path, row]))
  const byPathKey = new Map(rows.map((row) => [row.path.toLowerCase(), row.path]))
  const byName = new Map<string, string>()
  for (const row of rows) {
    const basename = (row.path.split('/').at(-1) ?? row.path).replace(/\.md$/i, '').toLowerCase()
    if (!byName.has(basename)) {
      byName.set(basename, row.path)
    }
    const title = row.title.toLowerCase()
    if (!byName.has(title)) {
      byName.set(title, row.path)
    }
  }
  return {
    rows,
    titleOf: (path) => byPath.get(path)?.title ?? path.replace(/\.md$/i, ''),
    resolve: (target) => {
      const cleaned = target
        .trim()
        .replaceAll(/^\[\[|\]\]$/g, '')
        .split('|')[0]!
        .split('#')[0]!
        .trim()
        .toLowerCase()
      if (cleaned === '') {
        return null
      }
      return byPathKey.get(cleaned) ?? byPathKey.get(`${cleaned}.md`) ?? byName.get(cleaned) ?? null
    },
  }
}

function matches(
  filter: BaseFilter | null,
  context: BaseEvaluationContext,
  cache: Map<string, BaseValue>,
): boolean {
  if (filter === null) {
    return true
  }
  switch (filter.kind) {
    case 'expression':
      try {
        return isTruthy(evaluateBaseExpression(filter.source, context, cache))
      } catch {
        return false
      }
    case 'and':
      return filter.items.every((item) => matches(item, context, cache))
    case 'or':
      return filter.items.some((item) => matches(item, context, cache))
    case 'not':
      return !filter.items.some((item) => matches(item, context, cache))
  }
}

function safeValue(
  id: string,
  context: BaseEvaluationContext,
  cache: Map<string, BaseValue>,
): BaseValue | Error {
  try {
    return basePropertyValue(id, context, cache)
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error))
  }
}

function cellFor(id: string, value: BaseValue | Error, row: BaseNoteRow): BaseCell {
  if (value instanceof Error) {
    return { text: '', links: [], error: value.message }
  }
  if (id === 'file.name' || id === 'file.basename' || id === 'file.path') {
    return { text: row.title, links: [{ path: row.path, title: row.title }], error: null }
  }
  const links: BaseCellLink[] = []
  const collect = (item: BaseValue): void => {
    if (typeof item === 'object' && item !== null) {
      if (item.kind === 'link' && item.path !== null) {
        links.push({ path: item.path, title: item.text })
      } else if (item.kind === 'file') {
        links.push({ path: item.row.path, title: item.row.title })
      } else if (item.kind === 'list') {
        for (const entry of item.items) {
          collect(entry)
        }
      }
    }
  }
  collect(value)
  return { text: baseValueText(value), links, error: null }
}

function sortValue(value: BaseValue | Error): BaseValue {
  if (value instanceof Error) {
    return null
  }
  if (typeof value === 'object' && value !== null && value.kind === 'list') {
    return value.items.length
  }
  return value
}

/**
 * Run the view at `viewIndex` of `definition` over `vault`.
 *
 * @param now Evaluation time (epoch ms) for `now()` and `today()`.
 */
export function runBaseView(
  definition: BaseDefinition,
  viewIndex: number,
  vault: BaseVault,
  now: number,
): BaseViewResult {
  const view = definition.views[viewIndex] ?? definition.views[0]!
  const columnIds = view.order.length > 0 ? view.order : ['file.name']
  const columns = columnIds.map((id) => ({ id, label: columnLabel(id, definition) }))
  const sortIds = view.sort.map((sort) => sort.property)
  if (view.groupBy !== null) {
    sortIds.push(view.groupBy.property)
  }

  const matched: { row: BaseNoteRow; values: Map<string, BaseValue | Error> }[] = []
  for (const row of vault.rows) {
    const context: BaseEvaluationContext = {
      row,
      now,
      formulas: definition.formulas,
      titleOf: vault.titleOf,
      resolve: vault.resolve,
    }
    const cache = new Map<string, BaseValue>()
    if (!matches(definition.filters, context, cache) || !matches(view.filters, context, cache)) {
      continue
    }
    const values = new Map<string, BaseValue | Error>()
    for (const id of new Set([...columnIds, ...sortIds])) {
      values.set(id, safeValue(id, context, cache))
    }
    matched.push({ row, values })
  }

  matched.sort((left, right) => {
    for (const sort of view.sort) {
      const order = compareNullsLast(
        sortValue(left.values.get(sort.property) ?? null),
        sortValue(right.values.get(sort.property) ?? null),
        sort.direction,
      )
      if (order !== 0) {
        return order
      }
    }
    return left.row.title.localeCompare(right.row.title, undefined, { numeric: true })
  })

  const limited = view.limit === null ? matched : matched.slice(0, view.limit)
  const rows = limited.map(({ row, values }) => ({
    path: row.path,
    title: row.title,
    cells: columnIds.map((id) => cellFor(id, values.get(id) ?? null, row)),
  }))

  const { layout, approximated } = layoutFor(view)
  return {
    name: view.name,
    type: view.type,
    layout,
    approximated,
    columns,
    rows,
    groups: view.groupBy === null ? null : groupRows(view.groupBy, limited, rows),
    total: matched.length,
  }
}

function compareNullsLast(left: BaseValue, right: BaseValue, direction: 'asc' | 'desc'): number {
  const leftEmpty = left === null || left === ''
  const rightEmpty = right === null || right === ''
  if (leftEmpty || rightEmpty) {
    return leftEmpty === rightEmpty ? 0 : leftEmpty ? 1 : -1
  }
  const order = compareBaseValues(left, right) ?? 0
  return direction === 'desc' ? -order : order
}

function groupRows(
  groupBy: NonNullable<BaseViewDefinition['groupBy']>,
  matched: readonly { row: BaseNoteRow; values: Map<string, BaseValue | Error> }[],
  rows: readonly BaseResultRow[],
): BaseResultGroup[] {
  const groups = new Map<string, { value: BaseValue; rows: BaseResultRow[] }>()
  for (const [index, entry] of matched.entries()) {
    const raw = entry.values.get(groupBy.property) ?? null
    const value = raw instanceof Error ? null : raw
    const key = baseValueText(value)
    const group = groups.get(key) ?? { value, rows: [] }
    group.rows.push(rows[index]!)
    groups.set(key, group)
  }
  const explicit = groupBy.order.map((key) => key.toLowerCase())
  return [...groups]
    .sort(([leftKey, left], [rightKey, right]) => {
      const leftRank = explicit.indexOf(leftKey.toLowerCase())
      const rightRank = explicit.indexOf(rightKey.toLowerCase())
      if (leftRank !== -1 || rightRank !== -1) {
        return (leftRank === -1 ? Infinity : leftRank) - (rightRank === -1 ? Infinity : rightRank)
      }
      return compareNullsLast(left.value, right.value, groupBy.direction)
    })
    .map(([key, group]) => ({ key, rows: group.rows }))
}
