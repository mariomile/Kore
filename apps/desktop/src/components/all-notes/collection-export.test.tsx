import { describe, expect, it } from 'vitest'
import type { CollectionEntry, TagType } from '@reflect/core'
import { collectionCsv } from './collection-export'

const BOOK_TYPE: TagType = {
  properties: [
    { name: 'Author', key: 'author', type: 'text' },
    { name: 'Rating', key: 'rating', type: 'number' },
    { name: 'Read', key: 'read', type: 'checkbox' },
    { name: 'Authors', key: 'authors', type: 'relations' },
  ],
}

function entry(overrides: Partial<CollectionEntry>): CollectionEntry {
  return {
    path: 'notes/dispossessed.md',
    title: 'The Dispossessed',
    mtime: 0,
    isPinned: false,
    properties: {},
    ...overrides,
  }
}

describe('collectionCsv', () => {
  it('emits a header from the schema and display readings per cell', () => {
    const csv = collectionCsv(BOOK_TYPE, [
      entry({
        properties: {
          author: { value: 'Le Guin', valueType: 'string', valueNumber: null },
          rating: { value: '4.5', valueType: 'number', valueNumber: 4.5 },
          read: { value: 'true', valueType: 'boolean', valueNumber: null },
          authors: {
            value: '["[[Le Guin]]","[[Frank Herbert|Herbert]]"]',
            valueType: 'list',
            valueNumber: null,
          },
        },
      }),
    ])
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('Title,Author,Rating,Read,Authors,Path')
    // Relations by their titles; the comma-joined list forces quoting.
    expect(lines[1]).toBe(
      'The Dispossessed,Le Guin,4.5,true,"Le Guin, Herbert",notes/dispossessed.md',
    )
  })

  it('quotes commas and doubles embedded quotes (RFC 4180)', () => {
    const csv = collectionCsv(BOOK_TYPE, [
      entry({
        title: 'Nice, "Great" Book',
        properties: {
          author: { value: 'Le Guin, Ursula', valueType: 'string', valueNumber: null },
        },
      }),
    ])
    // Absent values (rating, read, authors) stay empty cells.
    expect(csv.split('\r\n')[1]).toBe(
      '"Nice, ""Great"" Book","Le Guin, Ursula",,,,notes/dispossessed.md',
    )
  })
})
