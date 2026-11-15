import { useSyncExternalStore } from 'react'

/**
 * Whether a reading screen has scrolled the floating tab bar out of the way
 * (iPhone design pass, 2026-11): scrolling down into a note
 * hides it the way Safari hides its toolbar, scrolling up brings it back.
 * One module-level flag, because the scroller (a pushed note screen) and the
 * bar (the shell) are siblings.
 */
let hidden = false
const listeners = new Set<() => void>()

export function setTabBarScrolledAway(next: boolean): void {
  if (hidden === next) return
  hidden = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useTabBarScrolledAway(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => hidden,
    () => false,
  )
}
