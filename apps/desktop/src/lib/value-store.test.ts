import { describe, expect, it } from 'vitest'
import { createValueStore } from './value-store'

describe('createValueStore', () => {
  it('notifies subscribers on set', () => {
    const store = createValueStore(0)
    let notified = 0
    store.subscribe(() => {
      notified += 1
    })
    store.set(1)
    expect(store.get()).toBe(1)
    expect(notified).toBe(1)
  })

  it('does not notify when the next value is Object.is-equal', () => {
    const value = { a: 1 }
    const store = createValueStore(value)
    let notified = 0
    store.subscribe(() => {
      notified += 1
    })
    store.set(value)
    expect(notified).toBe(0)
  })

  it('stops notifying after unsubscribe', () => {
    const store = createValueStore(0)
    let notified = 0
    const unsubscribe = store.subscribe(() => {
      notified += 1
    })
    store.set(1)
    expect(notified).toBe(1)
    unsubscribe()
    store.set(2)
    expect(notified).toBe(1)
  })
})
