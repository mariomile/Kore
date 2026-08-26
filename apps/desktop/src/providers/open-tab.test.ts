import { describe, expect, it } from 'vitest'
import { openTabForRoute, routeForOpenTab, tabKey } from './open-tab'

describe('openTabForRoute', () => {
  it('opens a note tab for ordinary notes and a surface tab for Settings and Browser', () => {
    expect(openTabForRoute({ kind: 'note', path: 'notes/alpha.md' })).toEqual({
      kind: 'note',
      path: 'notes/alpha.md',
      pinned: false,
    })
    expect(openTabForRoute({ kind: 'settings' })).toEqual({
      kind: 'surface',
      surface: 'settings',
      pinned: false,
    })
    expect(openTabForRoute({ kind: 'graphs' })).toEqual({
      kind: 'surface',
      surface: 'settings',
      pinned: false,
    })
    expect(openTabForRoute({ kind: 'browser' })).toEqual({
      kind: 'surface',
      surface: 'browser',
      pinned: false,
    })
  })

  it('leaves Daily, search, and other sidebar screens off the strip', () => {
    expect(openTabForRoute({ kind: 'today' })).toBeNull()
    expect(openTabForRoute({ kind: 'daily', date: '2026-08-26' })).toBeNull()
    expect(openTabForRoute({ kind: 'search', query: 'x' })).toBeNull()
    expect(openTabForRoute({ kind: 'tasks' })).toBeNull()
    expect(openTabForRoute({ kind: 'chat' })).toBeNull()
  })
})

describe('routeForOpenTab', () => {
  it('round-trips notes and surfaces to their canonical routes', () => {
    expect(routeForOpenTab({ kind: 'note', path: 'notes/alpha.md', pinned: false })).toEqual({
      kind: 'note',
      path: 'notes/alpha.md',
    })
    expect(routeForOpenTab({ kind: 'surface', surface: 'settings', pinned: false })).toEqual({
      kind: 'settings',
    })
    expect(routeForOpenTab({ kind: 'surface', surface: 'browser', pinned: false })).toEqual({
      kind: 'browser',
    })
  })
})

describe('tabKey', () => {
  it('ignores pin state so a pin toggle does not duplicate the tab', () => {
    expect(tabKey({ kind: 'surface', surface: 'browser', pinned: false })).toBe(
      tabKey({ kind: 'surface', surface: 'browser', pinned: true }),
    )
  })
})
