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

describe('parseCollectionCsv — Plan 29 T1 types', () => {
  const TYPED: TagType = {
    properties: [
      { name: 'Owner', key: 'owner', type: 'person' },
      { name: 'Started', key: 'started', type: 'created' },
      { name: 'Touched', key: 'touched', type: 'updated' },
      {
        name: 'Books',
        key: 'books',
        type: 'reverse',
        reverse: { tag: 'book', property: 'owner' },
      },
    ],
  }

  it('links a person cell, imports created, and never imports view-only columns', () => {
    const csv = [
      'Title,Owner,Started,Touched,Books',
      'Standup,Ada Lovelace,2020-01-01,2026-08-31,"A, B"',
    ].join('\n')
    expect(parseCollectionCsv(csv, TYPED)).toEqual([
      {
        title: 'Standup',
        // `touched` (updated) and `books` (reverse) are computed views; a
        // CSV's created date is history and imports verbatim.
        properties: { owner: '[[Ada Lovelace]]', started: '2020-01-01' },
      },
    ])
  })
})
