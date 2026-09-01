import { describe, expect, it } from 'vitest'
import { evaluateFormula } from './formula'
import type { PropertyValue } from './property-values'

function stored(value: string, valueType: PropertyValue['valueType'] = 'string'): PropertyValue {
  return {
    value,
    valueType,
    valueNumber: valueType === 'number' ? Number(value) : null,
  }
}

const ROW: Record<string, PropertyValue> = {
  price: stored('120', 'number'),
  rating: stored('4.5', 'number'),
  title: stored('The Dispossessed'),
  read: stored('true', 'boolean'),
  topics: { value: JSON.stringify(['sci-fi', 'utopia']), valueType: 'list', valueNumber: 2 },
}

describe('evaluateFormula', () => {
  it('does arithmetic with precedence and parentheses', () => {
    expect(evaluateFormula('1 + 2 * 3', {})).toEqual({ text: '7', number: 7 })
    expect(evaluateFormula('(1 + 2) * 3', {})).toEqual({ text: '9', number: 9 })
    expect(evaluateFormula('-4 / 2', {})).toEqual({ text: '-2', number: -2 })
  })

  it('reads the row through prop(), typed', () => {
    expect(evaluateFormula('prop("price") * 1.5', ROW)).toEqual({ text: '180', number: 180 })
    expect(evaluateFormula('prop("title")', ROW)).toEqual({
      text: 'The Dispossessed',
      number: null,
    })
    expect(evaluateFormula('prop("topics")', ROW)).toEqual({ text: 'sci-fi, utopia', number: null })
    // A missing key reads as empty — concatenation tolerates it, math does not.
    expect(evaluateFormula('concat("x", prop("missing"))', ROW)).toEqual({
      text: 'x',
      number: null,
    })
    // Emptiness propagates like SQL NULL: numeric work over a missing value
    // yields an empty cell, never an error and never a phantom zero.
    expect(evaluateFormula('prop("missing") + 1', ROW)).toEqual({ text: '', number: null })
    expect(evaluateFormula('prop("missing") * 2', ROW)).toEqual({ text: '', number: null })
    expect(evaluateFormula('prop("missing") > 3', ROW)).toEqual({ text: '', number: null })
    expect(evaluateFormula('prop("missing") == ""', ROW)).toEqual({ text: 'false', number: null })
    expect(evaluateFormula('empty(prop("missing"))', ROW)).toEqual({ text: 'true', number: null })
  })

  it('rounds display to two decimals but keeps the number exact', () => {
    const result = evaluateFormula('prop("rating") / 3', ROW)
    expect(result).toEqual({ text: '1.5', number: 1.5 })
    expect(evaluateFormula('10 / 3', {})).toEqual({ text: '3.33', number: 10 / 3 })
  })

  it('compares, branches, and combines booleans', () => {
    expect(evaluateFormula('if(prop("price") > 100, "dear", "cheap")', ROW)).toEqual({
      text: 'dear',
      number: null,
    })
    expect(evaluateFormula('prop("read") and prop("rating") >= 4', ROW)).toEqual({
      text: 'true',
      number: null,
    })
    expect(evaluateFormula('not empty(prop("title"))', ROW)).toEqual({
      text: 'true',
      number: null,
    })
    expect(evaluateFormula('"a" < "b"', {})).toEqual({ text: 'true', number: null })
  })

  it('offers the small function set', () => {
    expect(evaluateFormula('round(2.678, 1)', {})).toEqual({ text: '2.7', number: 2.7 })
    expect(evaluateFormula('abs(0 - 5)', {})).toEqual({ text: '5', number: 5 })
    expect(evaluateFormula('min(3, 1, 2)', {})).toEqual({ text: '1', number: 1 })
    expect(evaluateFormula('max(3, 1, 2)', {})).toEqual({ text: '3', number: 3 })
    expect(evaluateFormula('length(prop("title"))', ROW)).toEqual({ text: '16', number: 16 })
    expect(evaluateFormula('format(prop("price"))', ROW)).toEqual({ text: '120', number: null })
  })

  it('fails deterministically, never throws', () => {
    expect(evaluateFormula('1 / 0', {})).toEqual({ error: 'division by zero' })
    expect(evaluateFormula('"a" * 2', {})).toEqual({ error: '* expects a number' })
    expect(evaluateFormula('nope(1)', {})).toEqual({ error: 'unknown function nope' })
    expect(evaluateFormula('price + 1', ROW)).toEqual({
      error: 'unknown name price — property values are read with prop("key")',
    })
    expect(evaluateFormula('1 +', {})).toEqual({ error: 'unexpected end of expression' })
    expect(evaluateFormula('(1', {})).toEqual({ error: 'missing )' })
    expect(evaluateFormula('"open', {})).toEqual({ error: 'unterminated string' })
    expect(evaluateFormula('1 ; 2', {})).toEqual({ error: 'unexpected character ;' })
    expect(evaluateFormula('if(1, 2, 3)', {})).toEqual({ error: 'if expects true or false' })
    expect(evaluateFormula('1 > "a"', {})).toEqual({
      error: '> expects two numbers or two strings',
    })
  })
})
