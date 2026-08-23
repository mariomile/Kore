import { describe, expect, it } from 'vitest'
import type { TagType } from '@reflect/core'
import { parseCollectionCsv } from './collection-import'

const BOOK_TYPE: TagType = {
  properties: [
    { name: 'Author', key: 'author', type: 'text' },
    { name: 'Rating', key: 'rating', type: 'number' },
    { name: 'Read', key: 'read', type: 'checkbox' },
    { name: 'Topics', key: 'topics', type: 'multiselect', options: [] },
    { name: 'Authors', key: 'authors', type: 'relations' },
  ],
}

describe('parseCollectionCsv', () => {
  it('matches columns by name or key and types each cell', () => {
    const csv = [
      'Title,Author,rating,Read,Topics,Authors',
      'The Dispossessed,Le Guin,4.5,true,"sci-fi, utopia","Le Guin, Herbert"',
      ',,,,,',
      'Untitled row?,,,false,,',
    ].join('\r\n')
    expect(parseCollectionCsv(csv, BOOK_TYPE)).toEqual([
      {
        title: 'The Dispossessed',
        properties: {
          author: 'Le Guin',
          rating: 4.5,
          read: true,
          topics: ['sci-fi', 'utopia'],
          authors: ['[[Le Guin]]', '[[Herbert]]'],
        },
      },
      { title: 'Untitled row?', properties: { read: false } },
    ])
  })

  it('falls back to the first column as the title and skips Path', () => {
    const csv = 'Name,Path,Author\nDune,notes/x.md,Herbert\n'
    expect(parseCollectionCsv(csv, BOOK_TYPE)).toEqual([
      { title: 'Dune', properties: { author: 'Herbert' } },
    ])
  })

  it('handles semicolon-delimited exports and empty files', () => {
    expect(parseCollectionCsv('Title;Author\nDune;Herbert', BOOK_TYPE)).toEqual([
      { title: 'Dune', properties: { author: 'Herbert' } },
    ])
    expect(parseCollectionCsv('', BOOK_TYPE)).toEqual([])
  })
})
