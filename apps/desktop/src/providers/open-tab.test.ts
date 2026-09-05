import { describe, expect, it } from 'vitest'
import { untitledNotePath } from '@reflect/core'
import { openTabForRoute, routeForOpenTab, tabKey } from './open-tab'

describe('openTabForRoute', () => {
  it('opens notes immediately, including untitled placeholders', () => {
    expect(openTabForRoute({ kind: 'note', path: 'notes/alpha.md' })).toEqual({
      kind: 'note',
      path: 'notes/alpha.md',
      pinned: false,
    })
    const untitledPath = untitledNotePath()
    expect(openTabForRoute({ kind: 'note', path: untitledPath })).toEqual({
      kind: 'note',
      path: untitledPath,
      pinned: false,
    })
  })

  it('maps every workspace route to a singleton surface tab', () => {
    expect(openTabForRoute({ kind: 'today' })).toEqual({
      kind: 'surface',
      surface: 'daily',
      date: null,
      pinned: false,
    })
    expect(openTabForRoute({ kind: 'daily', date: '2026-08-26' })).toEqual({
      kind: 'surface',
      surface: 'daily',
      date: '2026-08-26',
      pinned: false,
    })
    expect(openTabForRoute({ kind: 'allNotes', tag: 'book' })).toEqual({
      kind: 'surface',
      surface: 'allNotes',
      tag: 'book',
      pinned: false,
    })
    expect(openTabForRoute({ kind: 'search', query: 'alpha' })).toEqual({
      kind: 'surface',
      surface: 'search',
      query: 'alpha',
      pinned: false,
    })
    expect(openTabForRoute({ kind: 'settings' })).toBeNull()
    expect(openTabForRoute({ kind: 'graphs' })).toBeNull()
    expect(openTabForRoute({ kind: 'browser' })).toEqual({
      kind: 'surface',
      surface: 'browser',
      pinned: false,
    })
  })

  it('uses the active conversation as chat-tab identity', () => {
    expect(openTabForRoute({ kind: 'chat' }, 'conversation-1')).toEqual({
      kind: 'chat',
      conversationId: 'conversation-1',
      pinned: false,
    })
    expect(openTabForRoute({ kind: 'chat' })).toBeNull()
  })
})

describe('routeForOpenTab', () => {
  it('round-trips notes, chats, and surfaces to their routes', () => {
    expect(routeForOpenTab({ kind: 'note', path: 'notes/alpha.md', pinned: false })).toEqual({
      kind: 'note',
      path: 'notes/alpha.md',
    })
    expect(routeForOpenTab({ kind: 'surface', surface: 'browser', pinned: false })).toEqual({
      kind: 'browser',
    })
    expect(
      routeForOpenTab({ kind: 'chat', conversationId: 'conversation-1', pinned: false }),
    ).toEqual({ kind: 'chat' })
    expect(
      routeForOpenTab({
        kind: 'surface',
        surface: 'allNotes',
        tag: 'book',
        pinned: false,
      }),
    ).toEqual({ kind: 'allNotes', tag: 'book' })
  })
})

describe('tabKey', () => {
  it('ignores pin and singleton route state without collapsing conversations', () => {
    expect(tabKey({ kind: 'surface', surface: 'browser', pinned: false })).toBe(
      tabKey({ kind: 'surface', surface: 'browser', pinned: true }),
    )
    expect(tabKey({ kind: 'surface', surface: 'search', query: 'alpha', pinned: false })).toBe(
      tabKey({ kind: 'surface', surface: 'search', query: 'beta', pinned: true }),
    )
    expect(tabKey({ kind: 'chat', conversationId: 'one', pinned: false })).not.toBe(
      tabKey({ kind: 'chat', conversationId: 'two', pinned: false }),
    )
  })
})
