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

const email: TagProperty = { name: 'Email', key: 'email', type: 'email' }
const rating: TagProperty = { name: 'Score', key: 'score', type: 'rating' }
const files: TagProperty = { name: 'Attachments', key: 'attachments', type: 'files' }
const status: TagProperty = {
  name: 'Stage',
  key: 'stage',
  type: 'status',
  options: ['todo', 'done'],
}
const rollup: TagProperty = {
  name: 'Author score',
  key: 'author-score',
  type: 'rollup',
  rollup: { relation: 'author', property: 'score', aggregation: 'original' },
}

describe('readCellValue extra types', () => {
  it('flags a non-email string under an email column as a mismatch', () => {
    expect(
      readCellValue(email, { value: 'not-an-email', valueType: 'string', valueNumber: null }),
    ).toEqual({ text: 'not-an-email', checked: false, mismatch: true })
    expect(
      readCellValue(email, { value: 'ursula@example.com', valueType: 'string', valueNumber: null }),
    ).toEqual({ text: 'ursula@example.com', checked: false, mismatch: false })
  })

  it('formats a 1–5 rating as stars and mismatches anything else', () => {
    expect(
      readCellValue(rating, { value: '3', valueType: 'number', valueNumber: 3 }),
    ).toEqual({ text: '★★★☆☆', checked: false, mismatch: false })
    expect(
      readCellValue(rating, { value: '9', valueType: 'number', valueNumber: 9 }),
    ).toEqual({ text: '9', checked: false, mismatch: true })
  })

  it('displays file paths by basename', () => {
    expect(
      readCellValue(files, {
        value: '["assets/scan.pdf","cover.png"]',
        valueType: 'list',
        valueNumber: null,
      }),
    ).toEqual({ text: 'scan.pdf, cover.png', checked: false, mismatch: false })
  })

  it('reads a status option as plain text for the badge face', () => {
    expect(
      readCellValue(status, { value: 'done', valueType: 'string', valueNumber: null }),
    ).toEqual({ text: 'done', checked: false, mismatch: false })
  })

  it('displays an attached rollup cell without treating it as a write', () => {
    expect(
      readCellValue(rollup, { value: '5', valueType: 'number', valueNumber: 5 }),
    ).toEqual({ text: '5', checked: false, mismatch: false })
  })
})
