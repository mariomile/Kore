import { decodeStoredList } from './property-values'
import type { PropertyValue } from './property-values'

/**
 * Formula columns (Plan 29 T2, per Plan 25 I15): a view-only cell computed
 * from the row's *own* stored values by a small, pure expression language —
 * no I/O, no graph reads, no side effects, so a formula can never bypass
 * privacy or touch anything beyond the properties it is handed. Errors are
 * deterministic strings shown in the cell, never a broken view.
 *
 * The language, deliberately small:
 * - literals: numbers, `"strings"` / `'strings'`, `true` / `false`
 * - `prop("key")` reads the row's value under a frontmatter key
 * - arithmetic `+ - * /` (numbers; `+` concatenates when either side is
 *   text), unary `-`
 * - comparisons `== != > < >= <=` (same-kind operands)
 * - `and` / `or` / `not` over booleans
 * - functions: `if(cond, a, b)`, `concat(…)`, `round(n[, digits])`,
 *   `abs(n)`, `min(…)`, `max(…)`, `length(text)`, `empty(x)`, `format(x)`
 *
 * Formulas read the row's *stored* (and otherwise-derived) cells; they never
 * see each other — every formula on a schema evaluates against the same
 * snapshot, so there are no evaluation-order effects and no cycles.
 *
 * Emptiness propagates the SQL-NULL way: a missing value inside numeric or
 * boolean work makes the whole result empty (an absent cell), while text
 * work reads it as `''` and `==`/`!=`/`empty()` can test it. Errors are
 * reserved for real mistakes — a type mismatch, a bad parse, dividing by
 * zero — never for a row that simply hasn't filled a column yet.
 */

/** A successful evaluation: display text, plus the number when numeric. */
export interface FormulaOk {
  text: string
  number: number | null
}
/** A failed evaluation: one deterministic message (shown in the cell). */
export interface FormulaError {
  error: string
}
export type FormulaResult = FormulaOk | FormulaError

type Value =
  | { kind: 'number'; n: number }
  | { kind: 'text'; s: string }
  | { kind: 'bool'; b: boolean }
  | { kind: 'empty' }

class FormulaFailure extends Error {}

/** Empty propagation (not an error): the whole result is an absent cell. */
class EmptyResult extends Error {}

function fail(message: string): never {
  throw new FormulaFailure(message)
}

/** A stored cell as a formula value. Lists read as their joined text. */
function valueOf(stored: PropertyValue | undefined): Value {
  if (stored === undefined || stored.value === '') {
    return { kind: 'empty' }
  }
  if (stored.valueType === 'number') {
    const n = stored.valueNumber ?? Number(stored.value)
    return Number.isFinite(n) ? { kind: 'number', n } : { kind: 'text', s: stored.value }
  }
  if (stored.valueType === 'boolean') {
    return { kind: 'bool', b: stored.value === 'true' }
  }
  if (stored.valueType === 'list') {
    const entries = decodeStoredList(stored.value)
    return entries === null || entries.length === 0
      ? { kind: 'text', s: stored.value }
      : { kind: 'text', s: entries.join(', ') }
  }
  return { kind: 'text', s: stored.value }
}

function textOf(value: Value): string {
  switch (value.kind) {
    case 'number':
      return String(value.n)
    case 'text':
      return value.s
    case 'bool':
      return value.b ? 'true' : 'false'
    case 'empty':
      return ''
  }
}

function numberOf(value: Value, where: string): number {
  if (value.kind === 'empty') {
    throw new EmptyResult()
  }
  if (value.kind !== 'number') {
    fail(`${where} expects a number`)
  }
  return value.n
}

function boolOf(value: Value, where: string): boolean {
  if (value.kind === 'empty') {
    throw new EmptyResult()
  }
  if (value.kind !== 'bool') {
    fail(`${where} expects true or false`)
  }
  return value.b
}

// --- tokenizer ---

type Token =
  | { kind: 'number'; n: number }
  | { kind: 'string'; s: string }
  | { kind: 'ident'; name: string }
  | { kind: 'op'; op: string }
  | { kind: 'end' }

const OPERATORS = ['==', '!=', '>=', '<=', '+', '-', '*', '/', '(', ')', ',', '>', '<'] as const

function tokenize(expression: string): Token[] {
  const tokens: Token[] = []
  let index = 0
  outer: while (index < expression.length) {
    const char = expression[index] as string
    if (/\s/.test(char)) {
      index += 1
      continue
    }
    if (char === '"' || char === "'") {
      let s = ''
      index += 1
      while (index < expression.length) {
        const next = expression[index] as string
        if (next === '\\' && index + 1 < expression.length) {
          s += expression[index + 1]
          index += 2
        } else if (next === char) {
          index += 1
          tokens.push({ kind: 'string', s })
          continue outer
        } else {
          s += next
          index += 1
        }
      }
      fail('unterminated string')
    }
    if (/\d/.test(char) || (char === '.' && /\d/.test(expression[index + 1] ?? ''))) {
      const match = /^\d*\.?\d+/.exec(expression.slice(index)) as RegExpExecArray
      tokens.push({ kind: 'number', n: Number(match[0]) })
      index += match[0].length
      continue
    }
    if (/[a-z_]/i.test(char)) {
      const match = /^[a-z_]\w*/i.exec(expression.slice(index)) as RegExpExecArray
      tokens.push({ kind: 'ident', name: match[0] })
      index += match[0].length
      continue
    }
    for (const op of OPERATORS) {
      if (expression.startsWith(op, index)) {
        tokens.push({ kind: 'op', op })
        index += op.length
        continue outer
      }
    }
    fail(`unexpected character ${char}`)
  }
  tokens.push({ kind: 'end' })
  return tokens
}

// --- recursive-descent evaluator (no AST needed at this size) ---

class Evaluator {
  private index = 0
  constructor(
    private readonly tokens: Token[],
    private readonly properties: Readonly<Record<string, PropertyValue>>,
  ) {}

  evaluate(): Value {
    const value = this.parseOr()
    if (this.peek().kind !== 'end') {
      fail('unexpected trailing input')
    }
    return value
  }

  private peek(): Token {
    return this.tokens[this.index] as Token
  }

  private takeOp(op: string): boolean {
    const token = this.peek()
    if (token.kind === 'op' && token.op === op) {
      this.index += 1
      return true
    }
    return false
  }

  private takeIdent(name: string): boolean {
    const token = this.peek()
    if (token.kind === 'ident' && token.name === name) {
      this.index += 1
      return true
    }
    return false
  }

  private parseOr(): Value {
    let left = this.parseAnd()
    while (this.takeIdent('or')) {
      const a = boolOf(left, 'or')
      const b = boolOf(this.parseAnd(), 'or')
      left = { kind: 'bool', b: a || b }
    }
    return left
  }

  private parseAnd(): Value {
    let left = this.parseNot()
    while (this.takeIdent('and')) {
      const a = boolOf(left, 'and')
      const b = boolOf(this.parseNot(), 'and')
      left = { kind: 'bool', b: a && b }
    }
    return left
  }

  private parseNot(): Value {
    if (this.takeIdent('not')) {
      return { kind: 'bool', b: !boolOf(this.parseNot(), 'not') }
    }
    return this.parseComparison()
  }

  private parseComparison(): Value {
    const left = this.parseAdditive()
    for (const op of ['==', '!=', '>=', '<=', '>', '<']) {
      if (this.takeOp(op)) {
        const right = this.parseAdditive()
        return { kind: 'bool', b: compare(left, right, op) }
      }
    }
    return left
  }

  private parseAdditive(): Value {
    let left = this.parseMultiplicative()
    for (;;) {
      if (this.takeOp('+')) {
        const right = this.parseMultiplicative()
        if (
          (left.kind === 'empty' || right.kind === 'empty') &&
          left.kind !== 'text' &&
          right.kind !== 'text'
        ) {
          // Numeric-shaped addition over a missing value: empty, not 0.
          throw new EmptyResult()
        }
        left =
          left.kind === 'number' && right.kind === 'number'
            ? { kind: 'number', n: left.n + right.n }
            : { kind: 'text', s: textOf(left) + textOf(right) }
      } else if (this.takeOp('-')) {
        left = {
          kind: 'number',
          n: numberOf(left, '-') - numberOf(this.parseMultiplicative(), '-'),
        }
      } else {
        return left
      }
    }
  }

  private parseMultiplicative(): Value {
    let left = this.parseUnary()
    for (;;) {
      if (this.takeOp('*')) {
        left = { kind: 'number', n: numberOf(left, '*') * numberOf(this.parseUnary(), '*') }
      } else if (this.takeOp('/')) {
        const divisor = numberOf(this.parseUnary(), '/')
        if (divisor === 0) {
          fail('division by zero')
        }
        left = { kind: 'number', n: numberOf(left, '/') / divisor }
      } else {
        return left
      }
    }
  }

  private parseUnary(): Value {
    if (this.takeOp('-')) {
      return { kind: 'number', n: -numberOf(this.parseUnary(), 'unary -') }
    }
    return this.parsePrimary()
  }

  private parsePrimary(): Value {
    const token = this.peek()
    if (token.kind === 'number') {
      this.index += 1
      return { kind: 'number', n: token.n }
    }
    if (token.kind === 'string') {
      this.index += 1
      return { kind: 'text', s: token.s }
    }
    if (this.takeOp('(')) {
      const value = this.parseOr()
      if (!this.takeOp(')')) {
        fail('missing )')
      }
      return value
    }
    if (token.kind === 'ident') {
      this.index += 1
      if (token.name === 'true') {
        return { kind: 'bool', b: true }
      }
      if (token.name === 'false') {
        return { kind: 'bool', b: false }
      }
      if (!this.takeOp('(')) {
        fail(`unknown name ${token.name} — property values are read with prop("key")`)
      }
      const args: Value[] = []
      if (!this.takeOp(')')) {
        do {
          args.push(this.parseOr())
        } while (this.takeOp(','))
        if (!this.takeOp(')')) {
          fail('missing )')
        }
      }
      return this.call(token.name, args)
    }
    fail('unexpected end of expression')
  }

  private call(name: string, args: Value[]): Value {
    const arity = (count: number): void => {
      if (args.length !== count) {
        fail(`${name} expects ${count} argument${count === 1 ? '' : 's'}`)
      }
    }
    switch (name) {
      case 'prop': {
        arity(1)
        const key = args[0] as Value
        if (key.kind !== 'text') {
          fail('prop expects a "key" string')
        }
        return valueOf(this.properties[key.s])
      }
      case 'if': {
        arity(3)
        return boolOf(args[0] as Value, 'if') ? (args[1] as Value) : (args[2] as Value)
      }
      case 'concat':
        return { kind: 'text', s: args.map(textOf).join('') }
      case 'round': {
        if (args.length !== 1 && args.length !== 2) {
          fail('round expects 1 or 2 arguments')
        }
        const digits = args.length === 2 ? numberOf(args[1] as Value, 'round') : 0
        const factor = 10 ** Math.max(0, Math.min(10, Math.trunc(digits)))
        return {
          kind: 'number',
          n: Math.round(numberOf(args[0] as Value, 'round') * factor) / factor,
        }
      }
      case 'abs':
        arity(1)
        return { kind: 'number', n: Math.abs(numberOf(args[0] as Value, 'abs')) }
      case 'min':
      case 'max': {
        if (args.length === 0) {
          fail(`${name} expects at least 1 argument`)
        }
        const numbers = args.map((arg) => numberOf(arg, name))
        return { kind: 'number', n: name === 'min' ? Math.min(...numbers) : Math.max(...numbers) }
      }
      case 'length':
        arity(1)
        return { kind: 'number', n: textOf(args[0] as Value).length }
      case 'empty':
        arity(1)
        return { kind: 'bool', b: textOf(args[0] as Value) === '' }
      case 'format':
        arity(1)
        return { kind: 'text', s: textOf(args[0] as Value) }
      default:
        fail(`unknown function ${name}`)
    }
  }
}

function compare(left: Value, right: Value, op: string): boolean {
  if (op === '==' || op === '!=') {
    const equal =
      left.kind === right.kind &&
      (left.kind === 'empty' ||
        (left.kind === 'number' && left.n === (right as { n: number }).n) ||
        (left.kind === 'text' && left.s === (right as { s: string }).s) ||
        (left.kind === 'bool' && left.b === (right as { b: boolean }).b))
    return op === '==' ? equal : !equal
  }
  if (left.kind === 'empty' || right.kind === 'empty') {
    throw new EmptyResult()
  }
  if (left.kind === 'number' && right.kind === 'number') {
    return orderHolds(left.n, right.n, op)
  }
  if (left.kind === 'text' && right.kind === 'text') {
    return orderHolds(left.s, right.s, op)
  }
  fail(`${op} expects two numbers or two strings`)
}

function orderHolds(a: number | string, b: number | string, op: string): boolean {
  switch (op) {
    case '>':
      return a > b
    case '<':
      return a < b
    case '>=':
      return a >= b
    default:
      return a <= b
  }
}

/** Two-decimal display (the rollup convention); the number stays exact. */
function displayNumber(n: number): string {
  return String(Number.isSafeInteger(n) ? n : Math.round(n * 100) / 100)
}

/**
 * Evaluate `expression` over one row's stored values. Never throws — a
 * malformed expression or a type mismatch returns `{ error }` with a
 * deterministic message, the cell's honest face for it.
 */
export function evaluateFormula(
  expression: string,
  properties: Readonly<Record<string, PropertyValue>>,
): FormulaResult {
  try {
    const value = new Evaluator(tokenize(expression), properties).evaluate()
    if (value.kind === 'number') {
      if (!Number.isFinite(value.n)) {
        return { error: 'not a finite number' }
      }
      return { text: displayNumber(value.n), number: value.n }
    }
    return { text: textOf(value), number: null }
  } catch (cause) {
    if (cause instanceof EmptyResult) {
      return { text: '', number: null }
    }
    if (cause instanceof FormulaFailure) {
      return { error: cause.message }
    }
    throw cause
  }
}
