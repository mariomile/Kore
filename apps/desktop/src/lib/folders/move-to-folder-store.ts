import { useSyncExternalStore } from 'react'

/** Which note the Move to folder picker is open for; null when closed. */
let target: string | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

/** Open the Move to folder picker for `path` (context menu, palette, breadcrumb). */
export function openMoveToFolder(path: string): void {
  target = path
  emit()
}

export function closeMoveToFolder(): void {
  target = null
  emit()
}

export function useMoveToFolderTarget(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => target,
  )
}
