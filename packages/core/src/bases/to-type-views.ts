import { foldTag, isTagName } from '../markdown'
import { TITLE_SORT_KEY, UPDATED_SORT_KEY } from '../indexing/collections'
import type {
  CollectionPageView,
  CollectionSortSetting,
  SavedCollectionView,
  SavedCollectionViewFilter,
} from '../tags/tag-views'
import type { BaseDefinition, BaseFilter, BaseViewDefinition } from './base-file'
import { parseBaseExpression, type BaseExpression } from './expression'

/**
 * Turning an Obsidian base into a type's own views (organization point 3).
 * A base that lists one tag's notes (`file.hasTag("type/project")`) maps onto
 * that tag's database: each base view becomes a saved tab (layout, sort,
 * grouping, simple filters) and its plain property columns become the type's
 * fields. What Kore's views can't hold (formulas, folder rules, expressions
 * beyond one property compared to one value) is reported, never guessed at.
 *
 * Pure: a parsed base in, a plan out. The `.base` file is left as it is, so
 * Obsidian and Kore's read-only base screen keep working.
 */

/** What one base turns into, or why it can't. */
export type BaseConversion =
  | {
      readonly kind: 'converted'
      /** The folded tag whose type receives the views. */
      readonly tag: string
      readonly views: SavedCollectionView[]
      /** Plain property columns the views show, in first-seen order. */
      readonly columns: { readonly key: string; readonly name: string }[]
      /** What didn't carry over, one readable line each. */
      readonly notes: string[]
    }
  | { readonly kind: 'skipped'; readonly reason: string }

/** A condition we could not read as a tag rule or a view filter. */
interface Condition {
  readonly source: string
  readonly expression: BaseExpression | null
}

/** The tag a `file.hasTag("x")` / `file.tags.contains("x")` call names. */
function tagOf(expression: BaseExpression | null): string | null {
  if (expression?.type !== 'call' || expression.callee.type !== 'member') {
    return null
  }
  const { object, name } = expression.callee
  const onFile = object.type === 'identifier' && object.name === 'file' && name === 'hasTag'
  const onTags =
    (name === 'contains' || name === 'containsAny') &&
    ((object.type === 'identifier' && object.name === 'tags') ||
      (object.type === 'member' &&
        object.name === 'tags' &&
        object.object.type === 'identifier' &&
        object.object.name === 'file'))
  if (!onFile && !onTags) {
    return null
  }
  const [first, ...rest] = expression.args
  if (rest.length > 0 || first?.type !== 'literal' || typeof first.value !== 'string') {
    return null
  }
  const name_ = first.value.trim().replace(/^#/, '')
  return isTagName(name_) ? foldTag(name_) : null
}

/** A property reference (`status`, `note.status`), or null for anything else. */
function propertyOf(expression: BaseExpression): string | null {
  if (expression.type === 'identifier') {
    return ['file', 'formula', 'this', 'note', 'today', 'now'].includes(expression.name)
      ? null
      : expression.name
  }
  if (
    expression.type === 'member' &&
    expression.object.type === 'identifier' &&
    expression.object.name === 'note'
  ) {
    return expression.name
  }
  return null
}

function literalText(expression: BaseExpression): string | null {
  if (expression.type !== 'literal' || expression.value === null) {
    return null
  }
  return String(expression.value)
}

/** One Kore filter row for a simple comparison, or null when it isn't one. */
function filterOf(expression: BaseExpression | null): SavedCollectionViewFilter | null {
  if (expression === null) {
    return null
  }
  if (expression.type === 'binary') {
    const operator =
      expression.operator === '=='
        ? 'is'
        : expression.operator === '>'
          ? 'gt'
          : expression.operator === '<'
            ? 'lt'
            : null
    const key = propertyOf(expression.left)
    const text = literalText(expression.right)
    if (operator === null || key === null || text === null) {
      return null
    }
    if (operator !== 'is' && typeof (expression.right as { value?: unknown }).value !== 'number') {
      return null
    }
    return { key, operator, text }
  }
  if (expression.type === 'call' && expression.callee.type === 'member') {
    const key = propertyOf(expression.callee.object)
    if (key === null) {
      return null
    }
    if (expression.callee.name === 'isEmpty' && expression.args.length === 0) {
      return { key, operator: 'empty', text: '' }
    }
    const [arg] = expression.args
    if (expression.callee.name === 'contains' && expression.args.length === 1 && arg) {
      const text = literalText(arg)
      return text === null ? null : { key, operator: 'contains', text }
    }
    return null
  }
  if (expression.type === 'unary' && expression.operator === '!') {
    const inner = expression.operand
    const key = propertyOf(inner)
    if (key !== null) {
      return { key, operator: 'empty', text: '' }
    }
    const nested = filterOf(inner)
    return nested?.operator === 'empty' ? { ...nested, operator: 'notEmpty' } : null
  }
  const key = propertyOf(expression)
  return key === null ? null : { key, operator: 'notEmpty', text: '' }
}

function parse(source: string): BaseExpression | null {
  try {
    return parseBaseExpression(source)
  } catch {
    return null
  }
}

/** The conjuncts of a filter tree, or null when its top is not an `and`. */
function conjuncts(filter: BaseFilter | null): Condition[] | null {
  if (filter === null) {
    return []
  }
  if (filter.kind === 'expression') {
    return [{ source: filter.source, expression: parse(filter.source) }]
  }
  if (filter.kind !== 'and') {
    return null
  }
  const items: Condition[] = []
  for (const item of filter.items) {
    const nested = conjuncts(item)
    if (nested === null) {
      return null
    }
    items.push(...nested)
  }
  return items
}

/** Rules every note Kore lists already satisfies (`file.ext == "md"`). */
function isAlwaysTrue(expression: BaseExpression | null): boolean {
  return (
    expression?.type === 'binary' &&
    expression.operator === '==' &&
    expression.left.type === 'member' &&
    expression.left.name === 'ext' &&
    expression.left.object.type === 'identifier' &&
    expression.left.object.name === 'file' &&
    expression.right.type === 'literal' &&
    expression.right.value === 'md'
  )
}

/** Kore's sort key for a base property id, or null for formulas and file fields. */
function sortKeyOf(property: string): string | null {
  if (property === 'file.name' || property === 'file.basename') {
    return TITLE_SORT_KEY
  }
  if (property === 'file.mtime') {
    return UPDATED_SORT_KEY
  }
  return plainPropertyOf(property)
}

/** `note.status` / `status` → `status`; formula and file ids → null. */
function plainPropertyOf(property: string): string | null {
  if (property.startsWith('note.')) {
    return property.slice('note.'.length) || null
  }
  if (property.startsWith('formula.') || property.startsWith('file.') || property.includes('.')) {
    return null
  }
  return property === 'tags' ? null : property
}

function layoutOf(view: BaseViewDefinition): CollectionPageView | null {
  switch (view.type) {
    case 'table':
    case 'list':
      return 'table'
    case 'cards':
    case 'masonry':
    case 'gallery':
      return 'grid'
    case 'kanban':
    case 'board':
      return 'board'
    case 'calendar':
      return 'calendar'
    default:
      return null
  }
}

function idPart(text: string): string {
  return (
    text
      .toLowerCase()
      .replaceAll(/[^\p{L}\p{N}]+/gu, '-')
      .replaceAll(/^-+|-+$/g, '') || 'view'
  )
}

/** The display name for a column: the base's `displayName`, else the key. */
function columnName(base: BaseDefinition, key: string): string {
  return base.displayNames[`note.${key}`] ?? base.displayNames[key] ?? key
}

/**
 * Plan one base's conversion. `path` names the base in the notes and seeds
 * stable view ids (`base-<file>-<n>`), so converting the same base twice
 * replaces its tabs instead of adding copies.
 */
export function convertBaseToTypeViews(path: string, base: BaseDefinition): BaseConversion {
  const global = conjuncts(base.filters)
  if (global === null) {
    return { kind: 'skipped', reason: 'its filter combines rules with "or" or "not"' }
  }
  const tags = new Set(global.map((condition) => tagOf(condition.expression)).filter(Boolean))
  if (tags.size !== 1) {
    return {
      kind: 'skipped',
      reason:
        tags.size === 0
          ? 'it selects notes by folder or formula, not by one tag'
          : 'it combines more than one tag',
    }
  }
  const tag = [...tags][0] as string
  const notes: string[] = []
  const shared: SavedCollectionViewFilter[] = []
  for (const condition of global) {
    if (tagOf(condition.expression) !== null || isAlwaysTrue(condition.expression)) {
      continue
    }
    const filter = filterOf(condition.expression)
    if (filter === null) {
      // The base is a slice of the tag (one folder's tasks, say), not the
      // tag's database: its tabs on the type would list every note.
      return {
        kind: 'skipped',
        reason: `it narrows #${tag} with a rule a type's views can't hold (${condition.source})`,
      }
    }
    shared.push(filter)
  }

  const fileStem = idPart(path.replace(/^.*\//, '').replace(/\.base$/i, ''))
  const columns: { key: string; name: string }[] = []
  const addColumn = (key: string): void => {
    if (!columns.some((column) => column.key === key)) {
      columns.push({ key, name: columnName(base, key) })
    }
  }
  const formulaNotes = new Set<string>()
  const noteFormula = (property: string): void => {
    if (property.startsWith('formula.')) {
      const name = property.slice('formula.'.length)
      formulaNotes.add(base.displayNames[property] ?? name)
    }
  }

  const views: SavedCollectionView[] = base.views.map((view, index) => {
    let layout = layoutOf(view)
    if (layout === null) {
      notes.push(`"${view.name}": the ${view.type} layout opens as a table`)
      layout = 'table'
    }
    const groupKey = view.groupBy === null ? null : plainPropertyOf(view.groupBy.property)
    if (view.groupBy !== null) {
      noteFormula(view.groupBy.property)
      if (groupKey === null) {
        notes.push(`"${view.name}": grouping by ${view.groupBy.property} not carried`)
      } else {
        addColumn(groupKey)
      }
    }
    if (layout === 'board' && groupKey === null) {
      notes.push(`"${view.name}": a board needs a field to group by, so it opens as a table`)
      layout = 'table'
    }
    const sorts: CollectionSortSetting[] = []
    for (const sort of view.sort) {
      noteFormula(sort.property)
      const key = sortKeyOf(sort.property)
      if (key === null) {
        notes.push(`"${view.name}": sort by ${sort.property} not carried`)
        continue
      }
      sorts.push({ key, direction: sort.direction })
    }
    for (const property of view.order) {
      noteFormula(property)
      const key = plainPropertyOf(property)
      if (key !== null) {
        addColumn(key)
      }
    }
    if (view.limit !== null) {
      notes.push(`"${view.name}": the limit of ${String(view.limit)} rows is not carried`)
    }
    const own = conjuncts(view.filters)
    const filters = [...shared]
    let match: 'all' | 'any' = 'all'
    if (own === null) {
      const anyOf = view.filters?.kind === 'or' ? view.filters.items : null
      const parsed = anyOf?.map((item) =>
        item.kind === 'expression' ? filterOf(parse(item.source)) : null,
      )
      if (shared.length === 0 && parsed !== undefined && parsed.every((item) => item !== null)) {
        filters.push(...(parsed as SavedCollectionViewFilter[]))
        match = 'any'
      } else {
        notes.push(`"${view.name}": its filter combining rules with "or" is not carried`)
      }
    } else {
      for (const condition of own) {
        if (tagOf(condition.expression) === tag || isAlwaysTrue(condition.expression)) {
          continue
        }
        const filter = filterOf(condition.expression)
        if (filter === null) {
          notes.push(`"${view.name}": filter not carried: ${condition.source}`)
        } else {
          filters.push(filter)
        }
      }
    }
    for (const filter of filters) {
      addColumn(filter.key)
    }
    return {
      id: `base-${fileStem}-${String(index + 1)}`,
      name: view.name,
      view: layout,
      sorts,
      group: layout === 'board' ? groupKey : null,
      tableGroup: layout === 'board' ? null : groupKey,
      match,
      filters,
    }
  })
  for (const name of formulaNotes) {
    notes.push(`Formula "${name}" not carried: Kore can't run base formulas in a type's views`)
  }
  return { kind: 'converted', tag, views, columns, notes }
}

/**
 * Merge converted views into a type's existing tabs: a tab from the same
 * base (same id) is replaced in place, a new one is appended, and the user's
 * own tabs are never touched.
 */
export function mergeConvertedViews(
  existing: readonly SavedCollectionView[],
  converted: readonly SavedCollectionView[],
): SavedCollectionView[] {
  const incoming = new Map(converted.map((view) => [view.id, view]))
  const merged = existing.map((view) => {
    const replacement = incoming.get(view.id)
    if (replacement !== undefined) {
      incoming.delete(view.id)
      return replacement
    }
    return view
  })
  return [...merged, ...incoming.values()]
}
