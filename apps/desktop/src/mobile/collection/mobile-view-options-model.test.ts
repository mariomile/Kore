import { describe, expect, it } from 'vitest'
import { TITLE_SORT_KEY, UPDATED_SORT_KEY, type TagType } from '@kore/core'
import {
  addSort,
  fieldsSummary,
  flipSort,
  removeSort,
  sortFields,
  sortSummary,
  toggleFilter,
} from './mobile-view-options-model'

const PROJECT: TagType = {
  properties: [
    { name: 'Status', key: 'status', type: 'select', options: ['Idea', 'Done'] },
    { name: 'Due', key: 'due', type: 'date' },
  ],
}

describe('sortFields', () => {
  it('offers Title, the fields, then Updated', () => {
    expect(sortFields(PROJECT).map((field) => field.key)).toEqual([
      TITLE_SORT_KEY,
      'status',
      'due',
      UPDATED_SORT_KEY,
    ])
  })

  it('leaves the built-in Updated out when the schema has its own', () => {
    const type: TagType = { properties: [{ name: 'Edited', key: 'edited', type: 'updated' }] }
    expect(sortFields(type).map((field) => field.name)).toEqual(['Title', 'Edited'])
  })
})

describe('sort chain edits', () => {
  it('adds ascending, flips, removes, and summarises', () => {
    const one = addSort([], 'due')
    expect(one).toEqual([{ key: 'due', direction: 'asc' }])
    expect(addSort(one, 'due')).toEqual(one)
    const two = addSort(flipSort(one, 'due'), TITLE_SORT_KEY)
    expect(two).toEqual([
      { key: 'due', direction: 'desc' },
      { key: TITLE_SORT_KEY, direction: 'asc' },
    ])
    expect(sortSummary(PROJECT, two)).toBe('Due ↓ +1')
    expect(sortSummary(PROJECT, removeSort(two, 'due'))).toBe('Title ↑')
    expect(sortSummary(PROJECT, [])).toBe('None')
  })
})

describe('toggleFilter', () => {
  it('adds a condition once and drops it on the second tap', () => {
    const done = { key: 'status', operator: 'is' as const, text: 'Done' }
    const on = toggleFilter([], done)
    expect(on).toEqual([done])
    expect(toggleFilter(on, { ...done })).toEqual([])
  })
})

describe('fieldsSummary', () => {
  it('reads All until a field is hidden', () => {
    expect(fieldsSummary(PROJECT, new Set())).toBe('All')
    expect(fieldsSummary(PROJECT, new Set(['due']))).toBe('1 of 2')
  })
})
