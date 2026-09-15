import { describe, expect, it } from 'vitest'
import { moveSavedCollectionView, shiftSavedCollectionView } from './collection-views'
import type { SavedCollectionView } from './schema-collections'

function view(id: string): SavedCollectionView {
  return {
    id,
    name: id,
    view: 'table',
    sorts: [],
    group: null,
    tableGroup: null,
    match: 'all',
    filters: [],
  }
}

const VIEWS = [view('a'), view('b'), view('c')]
function ids(views: readonly SavedCollectionView[] | null): string[] | null {
  return views === null ? null : views.map((entry) => entry.id)
}

describe('moveSavedCollectionView', () => {
  it('drops the view into the target slot in either direction', () => {
    expect(ids(moveSavedCollectionView(VIEWS, 'c', 'a'))).toEqual(['c', 'a', 'b'])
    expect(ids(moveSavedCollectionView(VIEWS, 'a', 'c'))).toEqual(['b', 'c', 'a'])
    expect(VIEWS.map((entry) => entry.id)).toEqual(['a', 'b', 'c'])
  })

  it('returns null when nothing would change', () => {
    expect(moveSavedCollectionView(VIEWS, 'a', 'a')).toBeNull()
    expect(moveSavedCollectionView(VIEWS, 'a', 'missing')).toBeNull()
    expect(moveSavedCollectionView(VIEWS, 'missing', 'a')).toBeNull()
  })
})

describe('shiftSavedCollectionView', () => {
  it('swaps with the neighbour on that side and stops at the edges', () => {
    expect(ids(shiftSavedCollectionView(VIEWS, 'b', 'left'))).toEqual(['b', 'a', 'c'])
    expect(ids(shiftSavedCollectionView(VIEWS, 'b', 'right'))).toEqual(['a', 'c', 'b'])
    expect(shiftSavedCollectionView(VIEWS, 'a', 'left')).toBeNull()
    expect(shiftSavedCollectionView(VIEWS, 'c', 'right')).toBeNull()
    expect(shiftSavedCollectionView(VIEWS, 'missing', 'right')).toBeNull()
  })
})
