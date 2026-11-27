import type { SavedCollectionViewFilter } from '../tags/tag-views'
import type { BaseFilter } from './base-file'
import { parseBaseExpression, type BaseExpression } from './expression'

/**
 * The simple rules a database view's filter bar holds (one property
 * compared to one value), read from and written as Obsidian Bases filter
 * expressions: `status == "done"`, `tags.contains("x")`, `size > 3`,
 * `due.isEmpty()`, `!due.isEmpty()`. Shared by the base screen's view bar
 * and the base-to-type conversion, so both read a rule the same way.
 */

/** A condition we could not read as a tag rule or a view filter. */
export interface Condition {
  readonly source: string
  readonly expression: BaseExpression | null
}

/** A property reference (`status`, `note.status`), or null for anything else. */
export function propertyOf(expression: BaseExpression): string | null {
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
  if (
    expression.type === 'index' &&
    expression.object.type === 'identifier' &&
    expression.object.name === 'note' &&
    expression.index.type === 'literal' &&
    typeof expression.index.value === 'string'
  ) {
    return expression.index.value
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
export function filterOf(expression: BaseExpression | null): SavedCollectionViewFilter | null {
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

export function parseFilterSource(source: string): BaseExpression | null {
  try {
    return parseBaseExpression(source)
  } catch {
    return null
  }
}

/** The conjuncts of a filter tree, or null when its top is not an `and`. */
export function conjuncts(filter: BaseFilter | null): Condition[] | null {
  if (filter === null) {
    return []
  }
  if (filter.kind === 'expression') {
    return [{ source: filter.source, expression: parseFilterSource(filter.source) }]
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

/** `note.status` / `status` → `status`; formula and file ids → null. */
export function plainPropertyOf(property: string): string | null {
  if (property.startsWith('note.')) {
    return property.slice('note.'.length) || null
  }
  if (property.startsWith('formula.') || property.startsWith('file.') || property.includes('.')) {
    return null
  }
  return property === 'tags' ? null : property
}

/** A key as a base expression names it: bare when it is an identifier, else `note["…"]`. */
function propertyReference(key: string): string {
  return /^[a-z_]\w*$/i.test(key) && !RESERVED_NAMES.has(key) ? key : `note[${JSON.stringify(key)}]`
}

const RESERVED_NAMES = new Set([
  'file',
  'formula',
  'this',
  'note',
  'today',
  'now',
  'true',
  'false',
  'null',
])

/** A comparison value: a number stays a number, anything else is a quoted string. */
function valueLiteral(text: string, numeric: boolean): string {
  const trimmed = text.trim()
  return numeric && trimmed !== '' && Number.isFinite(Number(trimmed))
    ? String(Number(trimmed))
    : JSON.stringify(text)
}

/** The base expression for one filter-bar rule; reads back through {@link filterOf}. */
export function filterToExpression(filter: SavedCollectionViewFilter): string {
  const key = propertyReference(filter.key)
  switch (filter.operator) {
    case 'is':
      return `${key} == ${valueLiteral(filter.text, true)}`
    case 'contains':
      return `${key}.contains(${JSON.stringify(filter.text)})`
    case 'gt':
      return `${key} > ${valueLiteral(filter.text, true)}`
    case 'lt':
      return `${key} < ${valueLiteral(filter.text, true)}`
    case 'empty':
      return `${key}.isEmpty()`
    case 'notEmpty':
      return `!${key}.isEmpty()`
  }
}
