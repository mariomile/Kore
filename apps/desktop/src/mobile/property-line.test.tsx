import { describe, expect, it } from 'vitest'
import type { CollectionValue, TagType } from '@reflect/core'
import { propertyLine } from './property-line'

const BOOK_TYPE: TagType = {
  properties: [
    { name: 'Author', key: 'author', type: 'text' },
    { name: 'Rating', key: 'rating', type: 'number' },
    { name: 'Read', key: 'read', type: 'checkbox' },
    { name: 'Series', key: 'series', type: 'relation' },
    { name: 'Status', key: 'status', type: 'select', options: ['done'] },
  ],
}

function stored(value: string, valueType: CollectionValue['valueType']): CollectionValue {
  return { value, valueType, valueNumber: valueType === 'number' ? Number(value) : null }
}

describe('propertyLine', () => {
  it('joins set values in schema order, relations by title, capped at three', () => {
    expect(
      propertyLine(BOOK_TYPE, {
        author: stored('Le Guin', 'string'),
        rating: stored('4.5', 'number'),
        series: stored('[[Hainish Cycle|Hainish]]', 'string'),
        status: stored('done', 'string'),
      }),
    ).toBe('Author: Le Guin · Rating: 4.5 · Series: Hainish')
  })

  it('shows checkboxes only when checked and skips unset keys', () => {
    expect(propertyLine(BOOK_TYPE, { read: stored('true', 'boolean') })).toBe('Read ✓')
    expect(propertyLine(BOOK_TYPE, { read: stored('false', 'boolean') })).toBe('')
    expect(propertyLine(BOOK_TYPE, {})).toBe('')
  })
})
