import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import type { CollectionEntry, CollectionValue, TagType } from '@reflect/core'
import {
  applyCollectionFilters,
  CollectionFilterMenu,
  type CollectionFilter,
} from './collection-filter-menu'

const BOOK_TYPE: TagType = {
  properties: [
    { name: 'Author', key: 'author', type: 'text' },
    { name: 'Rating', key: 'rating', type: 'number' },
    { name: 'Status', key: 'status', type: 'select', options: ['to-read', 'done'] },
  ],
}

function stored(value: string, valueType: CollectionValue['valueType']): CollectionValue {
  return { value, valueType, valueNumber: valueType === 'number' ? Number(value) : null }
}

function entry(path: string, properties: Record<string, CollectionValue> = {}): CollectionEntry {
  return { path, title: path, mtime: 1, isPinned: false, properties }
}

const ROWS: CollectionEntry[] = [
  entry('a', {
    author: stored('Le Guin', 'string'),
    rating: stored('4.5', 'number'),
    status: stored('done', 'string'),
  }),
  entry('b', {
    author: stored('Herbert', 'string'),
    rating: stored('3', 'number'),
    status: stored('to-read', 'string'),
  }),
  entry('c', { author: stored('Banks', 'string') }),
]

function paths(filters: CollectionFilter[]): string[] {
  return applyCollectionFilters(BOOK_TYPE, ROWS, filters).map((row) => row.path)
}

describe('applyCollectionFilters', () => {
  it('ORs equality picks on one property and ANDs across properties', () => {
    expect(
      paths([
        { key: 'status', operator: 'is', text: 'done' },
        { key: 'status', operator: 'is', text: 'to-read' },
      ]),
    ).toEqual(['a', 'b'])
    expect(
      paths([
        { key: 'status', operator: 'is', text: 'done' },
        { key: 'author', operator: 'is', text: 'Herbert' },
      ]),
    ).toEqual([])
  })

  it('compares numbers numerically with gt/lt', () => {
    expect(paths([{ key: 'rating', operator: 'gt', text: '4' }])).toEqual(['a'])
    expect(paths([{ key: 'rating', operator: 'lt', text: '4' }])).toEqual(['b'])
  })

  it('matches contains case-insensitively', () => {
    expect(paths([{ key: 'author', operator: 'contains', text: 'guin' }])).toEqual(['a'])
  })

  it('filters empty and set values', () => {
    expect(paths([{ key: 'rating', operator: 'empty', text: '' }])).toEqual(['c'])
    expect(paths([{ key: 'status', operator: 'notEmpty', text: '' }])).toEqual(['a', 'b'])
  })

  it('matching any keeps a row when one condition holds', () => {
    // No row is both unread and rated above 4; each row satisfies one.
    const filters: CollectionFilter[] = [
      { key: 'status', operator: 'is', text: 'to-read' },
      { key: 'rating', operator: 'gt', text: '4' },
    ]
    expect(applyCollectionFilters(BOOK_TYPE, ROWS, filters, 'all')).toEqual([])
    expect(applyCollectionFilters(BOOK_TYPE, ROWS, filters, 'any').map((row) => row.path)).toEqual([
      'a',
      'b',
    ])
  })

  it('combines an equality OR with an extra condition on the same property', () => {
    expect(
      paths([
        { key: 'status', operator: 'is', text: 'done' },
        { key: 'status', operator: 'is', text: 'to-read' },
        { key: 'status', operator: 'contains', text: 'read' },
      ]),
    ).toEqual(['b'])
  })
})

describe('CollectionFilterMenu', () => {
  it('adds a builder condition and renders it as a removable chip', async () => {
    const onChange = vi.fn()
    const view = await render(
      <CollectionFilterMenu
        type={BOOK_TYPE}
        entries={ROWS}
        filters={[]}
        onChange={onChange}
        match="all"
        onMatchChange={() => {}}
      />,
    )

    await view.getByRole('button', { name: 'Filter by property' }).click()
    await view.getByRole('combobox', { name: 'Filter property' }).click()
    await view.getByRole('option', { name: 'Rating' }).click()
    await view.getByRole('combobox', { name: 'Filter operator' }).click()
    await view.getByRole('option', { name: '>', exact: true }).click()
    await view.getByLabelText('Filter value').fill('4')
    await view.getByRole('button', { name: 'Add filter' }).click()

    expect(onChange).toHaveBeenCalledWith([{ key: 'rating', operator: 'gt', text: '4' }])
  })

  it('renders active filters as chips that remove on click', async () => {
    const onChange = vi.fn()
    const view = await render(
      <CollectionFilterMenu
        type={BOOK_TYPE}
        entries={ROWS}
        filters={[{ key: 'rating', operator: 'gt', text: '4' }]}
        onChange={onChange}
        match="all"
        onMatchChange={() => {}}
      />,
    )

    await view.getByRole('button', { name: 'Rating > 4' }).click()
    expect(onChange).toHaveBeenCalledWith([])
  })
})
