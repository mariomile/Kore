import { useEffect, useState } from 'react'

/**
 * Work that must not run while the user scrolls: a queue drained one task per
 * frame, and only once every scroller has been still for {@link QUIET_MS}. A
 * frame that mounts a markdown preview is a frame the scroll does not get, so
 * the phone grid's cards wait here for the finger to rest.
 */
const QUIET_MS = 120

const queue = new Set<() => void>()
let lastScroll = 0
let frame: number | null = null
let listening = false

function drain(): void {
  frame = null
  if (queue.size === 0) {
    return
  }
  if (performance.now() - lastScroll >= QUIET_MS) {
    const [task] = queue
    if (task !== undefined) {
      queue.delete(task)
      task()
    }
  }
  schedule()
}

function schedule(): void {
  if (frame === null && queue.size > 0) {
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
 * rested. Stays true afterwards.
 */
export function useAfterScroll(wanted: boolean): boolean {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!wanted || ready) {
      return
    }
    const task = (): void => {
      setReady(true)
    }
    listen()
    queue.add(task)
    schedule()
    return () => {
      queue.delete(task)
    }
  }, [wanted, ready])

  return ready
}
