import { parseBaseExpression, type BaseExpression, type BinaryOperator } from './expression'
import { durationField, valueMethod } from './methods'
import {
  asDate,
  asDuration,
  asNumber,
  asText,
  basenameOf,
  baseValuesEqual,
  compareBaseValues,
  fail,
  fileNameOf,
  folderOf,
  fromProperty,
  isKind,
  isTruthy,
  type BaseEvaluationContext,
  type BaseLink,
  type BaseList,
  type BaseNoteRow,
  type BaseValue,
} from './values'

/**
 * Evaluator for Obsidian Bases expressions (see `expression.ts`) over one
 * note of the vault. Pure: everything a formula can see arrives in the
 * {@link BaseNoteRow} and the context, so a base can never reach beyond the
 * indexed vault (no file reads, no network).
 *
 * Covers what real bases use: `file.*` fields and methods (`hasTag`,
 * `inFolder`, `hasLink`, `hasProperty`), bare and `note.` properties,
 * `formula.` references, dates and durations (`now() - file.mtime`,
 * `.days`, `.format()`), string, number and list methods, `if`, `html`,
 * `link`. Anything unknown is a {@link BaseEvaluationError}, which the view
 * runner turns into "row excluded" for filters and an error cell for columns.
 */

interface Scope {
  readonly context: BaseEvaluationContext
  readonly locals: Readonly<Record<string, BaseValue>>
  readonly formulaStack: readonly string[]
  readonly formulaCache: Map<string, BaseValue>
}

/**
 * Evaluate `source` against one row.
 *
 * @throws {BaseEvaluationError} for an unknown name or a type mismatch;
 *   {@link BaseExpressionError} for a syntax error.
 */
export function evaluateBaseExpression(
  source: string,
  context: BaseEvaluationContext,
  formulaCache = new Map<string, BaseValue>(),
): BaseValue {
  return evaluate(parseBaseExpression(source), {
    context,
    locals: {},
    formulaStack: [],
    formulaCache,
  })
}

/**
 * The value of a property id as views name them: `file.mtime`,
 * `formula.age`, `note.status`, or a bare `status`. Read directly rather
 * than parsed, so a frontmatter key with spaces or dashes still works.
 */
export function basePropertyValue(
  id: string,
  context: BaseEvaluationContext,
  formulaCache = new Map<string, BaseValue>(),
): BaseValue {
  const scope: Scope = { context, locals: {}, formulaStack: [], formulaCache }
  if (id.startsWith('file.')) {
    return fileField(context.row, id.slice('file.'.length), scope)
  }
  if (id.startsWith('formula.')) {
    return formulaValue(id.slice('formula.'.length), scope)
  }
  const key = id.startsWith('note.') ? id.slice('note.'.length) : id
  return fromProperty(context.row.properties[key])
}

function noteLink(path: string, scope: Scope): BaseLink {
  return { kind: 'link', path, text: scope.context.titleOf(path) }
}

function linkList(paths: readonly string[], scope: Scope): BaseList {
  return { kind: 'list', items: paths.map((path) => noteLink(path, scope)) }
}

function evaluate(expression: BaseExpression, scope: Scope): BaseValue {
  switch (expression.type) {
    case 'literal':
      return expression.value
    case 'list':
      return { kind: 'list', items: expression.items.map((item) => evaluate(item, scope)) }
    case 'identifier':
      return identifier(expression.name, scope)
    case 'member':
      return member(evaluate(expression.object, scope), expression.name, scope)
    case 'index':
      return indexInto(evaluate(expression.object, scope), evaluate(expression.index, scope), scope)
    case 'unary': {
      const operand = evaluate(expression.operand, scope)
      return expression.operator === '!' ? !isTruthy(operand) : -asNumber(operand, 'minus')
    }
    case 'binary':
      return binary(expression.operator, expression.left, expression.right, scope)
    case 'call':
      return call(expression, scope)
  }
}

function identifier(name: string, scope: Scope): BaseValue {
  if (Object.hasOwn(scope.locals, name)) {
    return scope.locals[name] ?? null
  }
  switch (name) {
    case 'file':
      return { kind: 'file', row: scope.context.row }
    case 'note':
      return { kind: 'namespace', name: 'note' }
    case 'formula':
      return { kind: 'namespace', name: 'formula' }
    case 'this':
      return null
    default:
      return fromProperty(scope.context.row.properties[name])
  }
}

/** A `formula.<name>` value, computed once per row and cycle-checked. */
function formulaValue(name: string, scope: Scope): BaseValue {
  const cached = scope.formulaCache.get(name)
  if (cached !== undefined) {
    return cached
  }
  const source = scope.context.formulas[name]
  if (source === undefined) {
    return fail(`unknown formula ${name}`)
  }
  if (scope.formulaStack.includes(name)) {
    return fail(`formula ${name} refers to itself`)
  }
  const value = evaluate(parseBaseExpression(source), {
    ...scope,
    locals: {},
    formulaStack: [...scope.formulaStack, name],
  })
  scope.formulaCache.set(name, value)
  return value
}

function member(object: BaseValue, name: string, scope: Scope): BaseValue {
  if (object === null) {
    return null
  }
  if (isKind(object, 'namespace')) {
    return object.name === 'note'
      ? fromProperty(scope.context.row.properties[name])
      : formulaValue(name, scope)
  }
  if (isKind(object, 'file')) {
    return fileField(object.row, name, scope)
  }
  if (isKind(object, 'duration')) {
    return durationField(object, name)
  }
  if (isKind(object, 'date')) {
    const date = new Date(object.ms)
    switch (name) {
      case 'year':
        return date.getFullYear()
      case 'month':
        return date.getMonth() + 1
      case 'day':
        return date.getDate()
      case 'hour':
        return date.getHours()
      case 'minute':
        return date.getMinutes()
      case 'second':
        return date.getSeconds()
      case 'millisecond':
        return date.getMilliseconds()
    }
  }
  if (isKind(object, 'link')) {
    if (name === 'path') {
      return object.path
    }
    return null
  }
  if (name === 'length') {
    if (typeof object === 'string') {
      return object.length
    }
    if (isKind(object, 'list')) {
      return object.items.length
    }
  }
  return null
}

function fileField(row: BaseNoteRow, name: string, scope: Scope): BaseValue {
  switch (name) {
    case 'name':
      return fileNameOf(row.path)
    case 'basename':
      return basenameOf(row.path)
    case 'path':
      return row.path
    case 'folder':
      return folderOf(row.path)
    case 'ext':
      return 'md'
    case 'size':
      return row.size
    case 'mtime':
      return { kind: 'date', ms: row.mtime, time: true }
    case 'ctime':
      return { kind: 'date', ms: row.ctime, time: true }
    case 'tags':
      return { kind: 'list', items: [...row.tags] }
    case 'links':
      return linkList(row.links, scope)
    case 'backlinks':
      return linkList(row.backlinks, scope)
    case 'embeds':
      return { kind: 'list', items: [] }
    case 'properties':
      return { kind: 'namespace', name: 'note' }
    default:
      return null
  }
}

function indexInto(object: BaseValue, index: BaseValue, scope: Scope): BaseValue {
  if (isKind(object, 'list') && typeof index === 'number') {
    return object.items.at(index) ?? null
  }
  if (typeof object === 'string' && typeof index === 'number') {
    return object.at(index) ?? null
  }
  if (typeof index === 'string') {
    return member(object, index, scope)
  }
  return null
}

function binary(
  operator: BinaryOperator,
  leftExpression: BaseExpression,
  rightExpression: BaseExpression,
  scope: Scope,
): BaseValue {
  if (operator === '&&') {
    const left = evaluate(leftExpression, scope)
    return isTruthy(left) ? isTruthy(evaluate(rightExpression, scope)) : false
  }
  if (operator === '||') {
    const left = evaluate(leftExpression, scope)
    return isTruthy(left) ? true : isTruthy(evaluate(rightExpression, scope))
  }
  const left = evaluate(leftExpression, scope)
  const right = evaluate(rightExpression, scope)
  switch (operator) {
    case '==':
      return baseValuesEqual(left, right)
    case '!=':
      return !baseValuesEqual(left, right)
    case '>':
    case '<':
    case '>=':
    case '<=': {
      const order = compareBaseValues(left, right)
      if (order === null) {
        return false
      }
      return operator === '>'
        ? order > 0
        : operator === '<'
          ? order < 0
          : operator === '>='
            ? order >= 0
            : order <= 0
    }
    case '+':
      return add(left, right)
    case '-':
      return subtract(left, right)
    default:
      return arithmetic(operator, left, right)
  }
}

function add(left: BaseValue, right: BaseValue): BaseValue {
  if (isKind(left, 'date')) {
    const duration = asDuration(right)
    if (duration !== null) {
      return { kind: 'date', ms: left.ms + duration.ms, time: left.time }
    }
  }
  if (isKind(left, 'duration') && isKind(right, 'duration')) {
    return { kind: 'duration', ms: left.ms + right.ms }
  }
  if (isKind(left, 'list') && isKind(right, 'list')) {
    return { kind: 'list', items: [...left.items, ...right.items] }
  }
  if (typeof left === 'number' && typeof right === 'number') {
    return left + right
  }
  if (left === null && typeof right === 'number') {
    return null
  }
  if (typeof left === 'number' && right === null) {
    return null
  }
  return asText(left) + asText(right)
}

function subtract(left: BaseValue, right: BaseValue): BaseValue {
  if (left === null || right === null) {
    return null
  }
  if (isKind(left, 'date')) {
    const other = asDate(right)
    if (other !== null && !isKind(right, 'duration')) {
      return { kind: 'duration', ms: left.ms - other.ms }
    }
    const duration = asDuration(right)
    if (duration !== null) {
      return { kind: 'date', ms: left.ms - duration.ms, time: left.time }
    }
  }
  if (isKind(left, 'duration') && isKind(right, 'duration')) {
    return { kind: 'duration', ms: left.ms - right.ms }
  }
  return asNumber(left, 'subtraction') - asNumber(right, 'subtraction')
}

function arithmetic(operator: '*' | '/' | '%', left: BaseValue, right: BaseValue): BaseValue {
  if (left === null || right === null) {
    return null
  }
  const leftNumber = asNumber(left, operator)
  const rightNumber = asNumber(right, operator)
  if (operator === '*') {
    return leftNumber * rightNumber
  }
  if (rightNumber === 0) {
    return null
  }
  return operator === '/' ? leftNumber / rightNumber : leftNumber % rightNumber
}

function call(expression: Extract<BaseExpression, { type: 'call' }>, scope: Scope): BaseValue {
  const { callee, args } = expression
  if (callee.type === 'identifier') {
    return globalFunction(callee.name, args, scope)
  }
  if (callee.type !== 'member') {
    return fail('only functions and methods can be called')
  }
  const target = evaluate(callee.object, scope)
  if (isKind(target, 'list') && (callee.name === 'filter' || callee.name === 'map')) {
    const body = args[0]
    if (body === undefined) {
      return fail(`${callee.name} needs an expression`)
    }
    const results = target.items.map((item, index) => ({
      item,
      result: evaluate(body, { ...scope, locals: { ...scope.locals, value: item, index } }),
    }))
    return {
      kind: 'list',
      items:
        callee.name === 'filter'
          ? results.filter((entry) => isTruthy(entry.result)).map((entry) => entry.item)
          : results.map((entry) => entry.result),
    }
  }
  const values = args.map((arg) => evaluate(arg, scope))
  return valueMethod(target, callee.name, values, scope.context)
}

function globalFunction(name: string, args: readonly BaseExpression[], scope: Scope): BaseValue {
  if (name === 'if') {
    const [condition, whenTrue, whenFalse] = args
    if (condition === undefined || whenTrue === undefined) {
      return fail('if needs a condition and a value')
    }
    if (isTruthy(evaluate(condition, scope))) {
      return evaluate(whenTrue, scope)
    }
    return whenFalse === undefined ? null : evaluate(whenFalse, scope)
  }
  const values = args.map((arg) => evaluate(arg, scope))
  const first = values[0] ?? null
  switch (name) {
    case 'now':
      return { kind: 'date', ms: scope.context.now, time: true }
    case 'today': {
      const today = new Date(scope.context.now)
      today.setHours(0, 0, 0, 0)
      return { kind: 'date', ms: today.getTime(), time: false }
    }
    case 'date':
      return asDate(first)
    case 'duration':
      return asDuration(first)
    case 'number':
      return first === null ? null : asNumber(first, 'number()')
    case 'string':
      return asText(first)
    case 'list':
      return isKind(first, 'list') ? first : { kind: 'list', items: first === null ? [] : [first] }
    case 'html':
      return { kind: 'html', html: asText(first) }
    case 'link': {
      const target = asText(first)
      const path = scope.context.resolve(target)
      const display = values[1]
      return {
        kind: 'link',
        path,
        text:
          display === undefined
            ? path === null
              ? target
              : scope.context.titleOf(path)
            : asText(display),
      }
    }
    case 'max':
    case 'min': {
      const numbers = values.filter((value) => value !== null).map((value) => asNumber(value, name))
      if (numbers.length === 0) {
        return null
      }
      return name === 'max' ? Math.max(...numbers) : Math.min(...numbers)
    }
    case 'escapeHTML':
      return asText(first)
    default:
      return fail(`unknown function ${name}`)
  }
}
