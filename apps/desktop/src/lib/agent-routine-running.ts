/**
 * The one routine run in flight right now, published by the runner for the
 * Agents screen: which routine is running and how to stop it. A tiny module
 * store rather than React state because the runner and the screen live in
 * different trees; `useSyncExternalStore`-shaped. One slot is enough by
 * construction — runs hold the process-wide agent run lock.
 */

export interface RunningRoutine {
  id: string
  /** Aborts the run mid-flight (kills the engine via its abort signal). */
  stop: () => void
}

let running: RunningRoutine | null = null
const listeners = new Set<() => void>()

/** Publish (or clear, with null) the run in flight. Runner-only. */
export function setRunningRoutine(next: RunningRoutine | null): void {
  running = next
  for (const listener of listeners) {
    listener()
  }
}

/** The run in flight, or null. Stable reference between notifications. */
export function getRunningRoutine(): RunningRoutine | null {
  return running
}

/** Subscribe to running-state changes; returns the unsubscribe function. */
export function subscribeRunningRoutine(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Stop the run in flight if it is this routine's. No-op otherwise. */
export function stopRunningRoutine(id: string): void {
  if (running?.id === id) {
    running.stop()
  }
}
