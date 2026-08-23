import { describe, expect, it } from 'vitest'
import type { TagProperty } from '@reflect/core'
import { readCellValue } from './collection-cell'

const relation: TagProperty = { name: 'Series', key: 'series', type: 'relation' }

describe('readCellValue', () => {
  it('displays a relation by its link title, alias first', () => {
    expect(
      readCellValue(relation, {
        value: '[[Hainish Cycle]]',
        valueType: 'string',
        valueNumber: null,
      }),
    ).toEqual({ text: 'Hainish Cycle', checked: false, mismatch: false })
    expect(
      readCellValue(relation, {
        value: '[[Hainish Cycle|Hainish]]',
        valueType: 'string',
        valueNumber: null,
      }),
    ).toEqual({ text: 'Hainish', checked: false, mismatch: false })
  })

  it('shows a bare string as a plain reference and a list as a mismatch', () => {
    expect(
      readCellValue(relation, { value: 'Hainish Cycle', valueType: 'string', valueNumber: null }),
    ).toEqual({ text: 'Hainish Cycle', checked: false, mismatch: false })
    expect(
      readCellValue(relation, { value: '["a"]', valueType: 'list', valueNumber: null }),
    ).toEqual({ text: '["a"]', checked: false, mismatch: true })
  })
})
