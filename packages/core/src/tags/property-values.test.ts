import { describe, expect, it } from 'vitest'
import {
  computeRollup,
  decodePropertyList,
  extractRelationTargets,
  fileBasename,
  formatRating,
  isEmailValue,
  parseRating,
  rollupSourceFromValue,
  type PropertyValue,
} from './property-values'

function cell(
  value: string,
  valueType: PropertyValue['valueType'],
  valueNumber: number | null = null,
): PropertyValue {
  return { value, valueType, valueNumber }
}

describe('email and rating', () => {
  it('accepts a plain email and rejects junk', () => {
    expect(isEmailValue('ursula@example.com')).toBe(true)
    expect(isEmailValue('not-an-email')).toBe(false)
    expect(isEmailValue('a@b')).toBe(false)
  })

  it('parses 1–5 ratings and formats stars', () => {
    expect(parseRating(3)).toBe(3)
    expect(parseRating(0)).toBeNull()
    expect(parseRating(3.5)).toBeNull()
    expect(formatRating(3)).toBe('★★★☆☆')
  })
})

describe('files and relation targets', () => {
  it('takes the filename of an asset path', () => {
    expect(fileBasename('assets/scan.pdf')).toBe('scan.pdf')
    expect(fileBasename('scan.pdf')).toBe('scan.pdf')
  })

  it('decodes a stored list and extracts wiki-link targets', () => {
    expect(decodePropertyList(cell('["a","b"]', 'list'))).toEqual(['a', 'b'])
    expect(extractRelationTargets(cell('[[Dune]]', 'string'))).toEqual(['Dune'])
    expect(extractRelationTargets(cell('["[[Dune]]","[[Foundation|Asimov]]"]', 'list'))).toEqual([
      'Dune',
      'Foundation',
    ])
  })
})

describe('computeRollup', () => {
  const sources = [
    rollupSourceFromValue(cell('4', 'number', 4)),
    rollupSourceFromValue(undefined),
    rollupSourceFromValue(cell('4', 'number', 4)),
    rollupSourceFromValue(cell('2', 'number', 2)),
  ]

  it('counts related notes, empty cells, the first value, and unique values', () => {
    expect(computeRollup('count', sources)).toEqual({ text: '4', number: 4 })
    expect(computeRollup('empty', sources)).toEqual({ text: '1', number: 1 })
    expect(computeRollup('original', sources)).toEqual({ text: '4', number: 4 })
    expect(computeRollup('unique', sources)).toEqual({ text: '4, 2', number: 2 })
  })
})
