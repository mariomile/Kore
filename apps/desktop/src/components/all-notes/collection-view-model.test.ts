import { describe, expect, it } from 'vitest'
import type { SavedCollectionView } from '@reflect/core'
import {
  LIVE_COLLECTION_VIEW_ID,
  collectionViewLabel,
  collectionViewsAppliedKey,
  resolveActiveCollectionViewId,
  uniqueCollectionViewName,
} from './collection-view-model'

describe('collectionViewLabel', () => {
  it('names each page view type', () => {
    expect(collectionViewLabel('table')).toBe('Table')
    expect(collectionViewLabel('board')).toBe('Board')
    expect(collectionViewLabel('calendar')).toBe('Calendar')
    expect(collectionViewLabel('grid')).toBe('Grid')
  })
})

describe('uniqueCollectionViewName', () => {
  it('keeps the base name when it is free, then suffixes from 2', () => {
    expect(uniqueCollectionViewName('Board', [])).toBe('Board')
    expect(uniqueCollectionViewName('Board', ['Table'])).toBe('Board')
    expect(uniqueCollectionViewName('Board', ['Board'])).toBe('Board 2')
    expect(uniqueCollectionViewName('Board', ['Board', 'Board 2'])).toBe('Board 3')
  })
})

describe('collectionViewsAppliedKey', () => {
  it('treats hydrating saved views as a new tab set, not an edit of the live tab', () => {
    expect(collectionViewsAppliedKey(null, [])).toBeNull()
    expect(collectionViewsAppliedKey('book', [])).toBe('book:live')
    expect(collectionViewsAppliedKey('book', ['v1', 'v2'])).toBe('book:v1,v2')
    expect(collectionViewsAppliedKey('book', [])).not.toBe(
      collectionViewsAppliedKey('book', ['v1']),
    )
  })
})

describe('resolveActiveCollectionViewId', () => {
  const views: SavedCollectionView[] = [
    {
      id: 'table-1',
      name: 'Table',
      view: 'table',
      sorts: [],
      group: null,
      tableGroup: null,
      match: 'all',
      filters: [],
    },
    {
      id: 'board-1',
      name: 'Board',
      view: 'board',
      sorts: [],
      group: 'status',
      tableGroup: null,
      match: 'all',
      filters: [],
    },
  ]

  it('returns null when nothing is saved', () => {
    expect(resolveActiveCollectionViewId([], undefined, 'table')).toBeNull()
  })

  it('prefers a still-present stored id', () => {
    expect(resolveActiveCollectionViewId(views, 'board-1', 'table')).toBe('board-1')
  })

  it('falls back to a view matching the live layout, then the first tab', () => {
    expect(resolveActiveCollectionViewId(views, 'gone', 'board')).toBe('board-1')
    expect(resolveActiveCollectionViewId(views, undefined, 'calendar')).toBe('table-1')
  })

  it('keeps the live sentinel out of persisted ids', () => {
    expect(LIVE_COLLECTION_VIEW_ID).toBe('__live')
    expect(resolveActiveCollectionViewId(views, LIVE_COLLECTION_VIEW_ID, 'table')).toBe('table-1')
  })
})
