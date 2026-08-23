import { describe, expect, it } from 'vitest'
import type { TagProperty } from '@reflect/core'
import { readCellValue } from './collection-cell'

const relation: TagProperty = { name: 'Series', key: 'series', type: 'relation' }
const relations: TagProperty = { name: 'Authors', key: 'authors', type: 'relations' }

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

  it('displays a multi-relation list as comma-joined link titles', () => {
    expect(
      readCellValue(relations, {
        value: '["[[Le Guin]]","[[Frank Herbert|Herbert]]"]',
        valueType: 'list',
        valueNumber: null,
      }),
    ).toEqual({ text: 'Le Guin, Herbert', checked: false, mismatch: false })
  })

  it('reads a single link under a multi-relation as a one-entry list', () => {
    expect(
      readCellValue(relations, { value: '[[Le Guin]]', valueType: 'string', valueNumber: null }),
    ).toEqual({ text: 'Le Guin', checked: false, mismatch: false })
  })

  it('flags non-list scalars under a multi-relation column as a mismatch', () => {
    expect(
      readCellValue(relations, { value: 'true', valueType: 'boolean', valueNumber: null }),
    ).toEqual({ text: 'true', checked: false, mismatch: true })
  })
})
