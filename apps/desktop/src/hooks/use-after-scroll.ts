import { useEffect, useState } from 'react'

/**
 * Work that must not run while the user scrolls: a queue drained a task or
 * two per frame, and only once every scroller has been still for
 * {@link QUIET_MS}. A frame that mounts a markdown preview is a frame the
 * scroll does not get, so the phone grid's cards wait here for the finger to
 * rest. Urgent tasks (a card on screen) go before the rest (a card being
 * prepared ahead), two to a frame: the reader is looking at them.
 */
const QUIET_MS = 120
const URGENT_PER_FRAME = 2

const urgentQueue = new Set<() => void>()
const queue = new Set<() => void>()
let lastScroll = -Infinity
let frame: number | null = null
let listening = false

function drain(): void {
  frame = null
  if (performance.now() - lastScroll >= QUIET_MS) {
    const from = urgentQueue.size > 0 ? urgentQueue : queue
    const tasks = [...from].slice(0, from === urgentQueue ? URGENT_PER_FRAME : 1)
    for (const task of tasks) {
      from.delete(task)
      task()
    }
  }
  schedule()
}

function schedule(): void {
  if (frame === null && urgentQueue.size + queue.size > 0) {
    frame = requestAnimationFrame(drain)
  }
}

function listen(): void {
  if (listening) {
    return
  }
  listening = true
  // Capture: scroll events do not bubble, and any scroller counts.
  window.addEventListener(
    'scroll',
    () => {
      lastScroll = performance.now()
    },
    { capture: true, passive: true },
  )
}

/**
 * Latches true some frames after `wanted` turns true, once scrolling has
 * rested. Stays true afterwards. `urgent` moves a waiting task ahead of
 * the ones that are not.
 */
export function useAfterScroll(wanted: boolean, urgent = false): boolean {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!wanted || ready) {
      return
    }
    const task = (): void => {
      setReady(true)
    }
    const tasks = urgent ? urgentQueue : queue
    listen()
    tasks.add(task)
    schedule()
    return () => {
      tasks.delete(task)
    }
  }, [wanted, urgent, ready])

  return ready
}
