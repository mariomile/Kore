/**
 * Parser for the expression language of Obsidian Bases (`.base` files):
 * the strings under `filters`, `formulas` and view `filters`, e.g.
 * `file.hasTag("type/project") && status == "active"` or
 * `(now() - file.mtime).days.round(0)`.
 *
 * Pure: text in, syntax tree out. Evaluation lives in `evaluate.ts`. The
 * grammar is the JavaScript-like subset Obsidian documents: literals, bare
 * property names, member access, calls, indexing, unary `!`/`-`, the
 * arithmetic, comparison and boolean operators, and parentheses.
 */

export type BaseExpression =
  | { readonly type: 'literal'; readonly value: string | number | boolean | null }
  | { readonly type: 'identifier'; readonly name: string }
  | { readonly type: 'list'; readonly items: readonly BaseExpression[] }
  | { readonly type: 'member'; readonly object: BaseExpression; readonly name: string }
  | { readonly type: 'index'; readonly object: BaseExpression; readonly index: BaseExpression }
  | {
      readonly type: 'call'
      readonly callee: BaseExpression
      readonly args: readonly BaseExpression[]
    }
  | { readonly type: 'unary'; readonly operator: '!' | '-'; readonly operand: BaseExpression }
  | {
      readonly type: 'binary'
      readonly operator: BinaryOperator
      readonly left: BaseExpression
      readonly right: BaseExpression
    }

export type BinaryOperator =
  | '||'
  | '&&'
  | '=='
  | '!='
  | '>'
  | '<'
  | '>='
  | '<='
  | '+'
  | '-'
  | '*'
  | '/'
  | '%'

/** A parse failure, reported with the offending expression. */
export class BaseExpressionError extends Error {}

type Token =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'name'; value: string }
  | { kind: 'op'; value: string }

const OPERATORS = ['&&', '||', '==', '!=', '>=', '<=', '>', '<', '+', '-', '*', '/', '%', '!']
const PUNCTUATION = new Set(['(', ')', '[', ']', ',', '.'])

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let cursor = 0
  while (cursor < source.length) {
    const char = source[cursor]!
    if (/\s/.test(char)) {
      cursor += 1
      continue
    }
    if (char === '"' || char === "'") {
      let value = ''
      let end = cursor + 1
      while (end < source.length && source[end] !== char) {
        if (source[end] === '\\' && end + 1 < source.length) {
          end += 1
        }
        value += source[end]
        end += 1
      }
      if (end >= source.length) {
        throw new BaseExpressionError(`unterminated string in ${source}`)
      }
      tokens.push({ kind: 'string', value })
      cursor = end + 1
      continue
    }
    const number = /^\d+(?:\.\d+)?/.exec(source.slice(cursor))
    if (number !== null) {
      tokens.push({ kind: 'number', value: Number(number[0]) })
      cursor += number[0].length
      continue
    }
    const name = /^[\p{L}_$][\p{L}\p{N}_$]*/u.exec(source.slice(cursor))
    if (name !== null) {
      tokens.push({ kind: 'name', value: name[0] })
      cursor += name[0].length
      continue
    }
    if (PUNCTUATION.has(char)) {
      tokens.push({ kind: 'op', value: char })
      cursor += 1
      continue
    }
    const operator = OPERATORS.find((candidate) => source.startsWith(candidate, cursor))
    if (operator === undefined) {
      throw new BaseExpressionError(`unexpected "${char}" in ${source}`)
    }
    tokens.push({ kind: 'op', value: operator })
    cursor += operator.length
  }
  return tokens
}

const BINARY_PRECEDENCE: Record<BinaryOperator, number> = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '>': 4,
  '<': 4,
  '>=': 4,
  '<=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
}

function isBinaryOperator(value: string): value is BinaryOperator {
  return Object.hasOwn(BINARY_PRECEDENCE, value)
}

class Parser {
  private position = 0
  private readonly tokens: Token[]
  private readonly source: string

  constructor(tokens: Token[], source: string) {
    this.tokens = tokens
    this.source = source
  }

  parse(): BaseExpression {
    const expression = this.binary(0)
    if (this.position < this.tokens.length) {
      throw new BaseExpressionError(`unexpected trailing input in ${this.source}`)
    }
    return expression
  }

  private peek(): Token | undefined {
    return this.tokens[this.position]
  }

  private isOp(value: string): boolean {
    const token = this.peek()
    return token?.kind === 'op' && token.value === value
  }

  private expectOp(value: string): void {
    if (!this.isOp(value)) {
      throw new BaseExpressionError(`expected "${value}" in ${this.source}`)
    }
    this.position += 1
  }

  private binary(minPrecedence: number): BaseExpression {
    let left = this.unary()
    for (;;) {
      const token = this.peek()
      if (token?.kind !== 'op' || !isBinaryOperator(token.value)) {
        return left
      }
      const precedence = BINARY_PRECEDENCE[token.value]
      if (precedence <= minPrecedence) {
        return left
      }
      this.position += 1
      const right = this.binary(precedence)
      left = { type: 'binary', operator: token.value, left, right }
    }
  }

  private unary(): BaseExpression {
    if (this.isOp('!') || this.isOp('-')) {
      const operator = this.isOp('!') ? '!' : '-'
      this.position += 1
      return { type: 'unary', operator, operand: this.unary() }
    }
    return this.postfix(this.primary())
  }

  private postfix(start: BaseExpression): BaseExpression {
    let expression = start
    for (;;) {
      if (this.isOp('.')) {
        this.position += 1
        const name = this.peek()
        if (name?.kind !== 'name') {
          throw new BaseExpressionError(`expected a name after "." in ${this.source}`)
        }
        this.position += 1
        expression = { type: 'member', object: expression, name: name.value }
      } else if (this.isOp('(')) {
        this.position += 1
        expression = { type: 'call', callee: expression, args: this.arguments(')') }
      } else if (this.isOp('[')) {
        this.position += 1
        const index = this.binary(0)
        this.expectOp(']')
        expression = { type: 'index', object: expression, index }
      } else {
        return expression
      }
    }
  }

  private arguments(close: string): BaseExpression[] {
    const args: BaseExpression[] = []
    if (this.isOp(close)) {
      this.position += 1
      return args
    }
    for (;;) {
      args.push(this.binary(0))
      if (this.isOp(',')) {
        this.position += 1
        continue
      }
      this.expectOp(close)
      return args
    }
  }

  private primary(): BaseExpression {
    const token = this.peek()
    if (token === undefined) {
      throw new BaseExpressionError(`unexpected end of ${this.source}`)
    }
    this.position += 1
    if (token.kind === 'number' || token.kind === 'string') {
      return { type: 'literal', value: token.value }
    }
    if (token.kind === 'name') {
      switch (token.value) {
        case 'true':
          return { type: 'literal', value: true }
        case 'false':
          return { type: 'literal', value: false }
        case 'null':
          return { type: 'literal', value: null }
        default:
          return { type: 'identifier', name: token.value }
      }
    }
    if (token.value === '(') {
      const inner = this.binary(0)
      this.expectOp(')')
      return inner
    }
    if (token.value === '[') {
      return { type: 'list', items: this.arguments(']') }
    }
    throw new BaseExpressionError(`unexpected "${token.value}" in ${this.source}`)
  }
}

const parsed = new Map<string, BaseExpression>()

/**
 * Parse one Bases expression. Results are memoized by source text: a base
 * evaluates the same few expressions against every note in the vault.
 *
 * @throws {BaseExpressionError} on a syntax error.
 */
export function parseBaseExpression(source: string): BaseExpression {
  const cached = parsed.get(source)
  if (cached !== undefined) {
    return cached
  }
  const expression = new Parser(tokenize(source), source).parse()
  if (parsed.size > 2000) {
    parsed.clear()
  }
  parsed.set(source, expression)
  return expression
}
