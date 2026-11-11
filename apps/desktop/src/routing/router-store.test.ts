import { describe, expect, it } from 'vitest'
import { emitNoteMoved } from '@/lib/note-moves'
import { createRouterStore } from './router-store'

describe('createRouterStore', () => {
  it('navigates, truncates forward history, and notifies subscribers', () => {
    const store = createRouterStore()
    let notified = 0
    store.subscribe(() => {
      notified += 1
    })
    store.navigate({ kind: 'daily', date: '2026-06-08' })
    store.navigate({ kind: 'note', path: 'notes/a.md' })
    store.back()
    expect(store.getSnapshot().route).toEqual({ kind: 'daily', date: '2026-06-08' })
    expect(store.getSnapshot().canForward).toBe(true)
    store.navigate({ kind: 'search', query: 'x' })
    expect(store.getSnapshot().canForward).toBe(false)
    expect(notified).toBe(4)
  })

  it('lets a view take Back first, then moves through history', () => {
    const store = createRouterStore()
    store.navigate({ kind: 'note', path: 'notes/a.md' })
    const owner = {}
    let stepped = 0
    store.setViewBack(owner, () => {
      stepped += 1
      store.setViewBack(owner, null)
    })
    expect(store.getSnapshot().canBack).toBe(true)
    const revision = store.navigationRevision()
    store.back()
    expect(stepped).toBe(1)
    expect(store.getSnapshot().route).toEqual({ kind: 'note', path: 'notes/a.md' })
    expect(store.navigationRevision()).toBe(revision)
    store.back()
    expect(store.getSnapshot().route).toEqual({ kind: 'today' })
    // A view step alone makes Back available at the bottom of the stack.
    store.setViewBack(owner, () => undefined)
    expect(store.getSnapshot().canBack).toBe(true)
    store.setViewBack(owner, null)
    expect(store.getSnapshot().canBack).toBe(false)
  })

  it('returns the same snapshot object until something changes', () => {
    const store = createRouterStore()
    const before = store.getSnapshot()
    store.back() // at the bottom of the stack: a true no-op
    expect(store.getSnapshot()).toBe(before)
    expect(store.navigationRevision()).toBe(0)
  })

  it('follows note moves only while connected', () => {
    const store = createRouterStore({ kind: 'note', path: 'notes/a.md' })
    const revisionBeforeConnect = store.navigationRevision()
    const disconnect = store.connect()
    emitNoteMoved('notes/a.md', 'notes/b.md')
    expect(store.getSnapshot().route).toEqual({ kind: 'note', path: 'notes/b.md' })
    expect(store.navigationRevision()).toBeGreaterThan(revisionBeforeConnect)
    disconnect()
    emitNoteMoved('notes/b.md', 'notes/c.md')
    expect(store.getSnapshot().route).toEqual({ kind: 'note', path: 'notes/b.md' })
  })
})
