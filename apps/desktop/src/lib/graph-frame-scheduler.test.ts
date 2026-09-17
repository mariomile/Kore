import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createGraphFrameScheduler } from './graph-frame-scheduler'

let visibility: DocumentVisibilityState
let documentEvents: EventTarget
let callbacks: Map<number, FrameRequestCallback>
let nextId: number
const schedulers: ReturnType<typeof createGraphFrameScheduler>[] = []

beforeEach(() => {
  visibility = 'visible'
  documentEvents = new EventTarget()
  Object.defineProperty(documentEvents, 'visibilityState', { get: () => visibility })
  callbacks = new Map()
  nextId = 0
  vi.stubGlobal('document', documentEvents)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextId++
    callbacks.set(id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id))
})

afterEach(() => {
  for (const scheduler of schedulers.splice(0)) scheduler.dispose()
  vi.unstubAllGlobals()
})

function tick(): void {
  const pending = [...callbacks]
  callbacks.clear()
  for (const [, callback] of pending) callback(0)
}

function scheduler(render: () => boolean) {
  const result = createGraphFrameScheduler(render)
  schedulers.push(result)
  return result
}

it('coalesces requests, continues only while moving, and wakes after settling', () => {
  let moving = true
  const render = vi.fn(() => moving)
  const frames = scheduler(render)
  frames.request()
  frames.request()
  frames.request()
  expect(callbacks.size).toBe(1)
  tick()
  expect(render).toHaveBeenCalledTimes(1)
  expect(callbacks.size).toBe(1)
  moving = false
  tick()
  expect(callbacks.size).toBe(0)
  tick()
  expect(render).toHaveBeenCalledTimes(2)
  frames.request()
  tick()
  expect(render).toHaveBeenCalledTimes(3)
  expect(callbacks.size).toBe(0)
})

it('pauses hidden documents, resumes once, and cancels work on disposal', () => {
  const render = vi.fn(() => true)
  const frames = scheduler(render)
  frames.request()
  visibility = 'hidden'
  documentEvents.dispatchEvent(new Event('visibilitychange'))
  expect(callbacks.size).toBe(0)
  frames.request()
  tick()
  expect(render).not.toHaveBeenCalled()
  visibility = 'visible'
  documentEvents.dispatchEvent(new Event('visibilitychange'))
  expect(callbacks.size).toBe(1)
  tick()
  expect(render).toHaveBeenCalledTimes(1)
  const lateCallback = [...callbacks.values()][0]!
  frames.dispose()
  expect(callbacks.size).toBe(0)
  lateCallback(0)
  frames.request()
  documentEvents.dispatchEvent(new Event('visibilitychange'))
  expect(render).toHaveBeenCalledTimes(1)
  expect(callbacks.size).toBe(0)
})
