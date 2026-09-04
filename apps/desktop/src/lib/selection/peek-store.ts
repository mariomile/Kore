import { useSyncExternalStore } from 'react'

/**
 * The note a list surface is pointing at without opening it: exactly one
 * selected row. The context rail's Details panel previews it on routes that
 * carry no note of their own (All Notes, a tag page) — the side peek. One
 * value per window; a surface sets it while it has a single selection and
 * clears it on the way out.
 */

let peekPath: string | null = null
const listeners = new Set<() => void>()

export function setPeekPath(path: string | null): void {
  if (path === peekPath) {
    return
  }
  peekPath = path
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function read(): string | null {
  return peekPath
}

/** The peeked note's path, or `null` while no list points at exactly one. */
export function usePeekPath(): string | null {
  return useSyncExternalStore(subscribe, read, read)
}
