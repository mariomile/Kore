import { useSyncExternalStore } from 'react'
import type { MoveTarget } from '@/lib/folders/use-folder-operations'

/** What the Mac's Move to… picker is open for; null while it's closed. */
let target: MoveTarget | null = null
const listeners = new Set<() => void>()

function emit(): void {
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

/** Open the Mac's Move to… picker (note context menu, sidebar folder menu, palette). */
export function openMoveTo(next: MoveTarget): void {
  target = next
  emit()
}

/** Close the Move to… picker. */
export function closeMoveTo(): void {
  target = null
  emit()
}

/** The note or folder the Move to… picker is open for, or null. */
export function useMoveToTarget(): MoveTarget | null {
  return useSyncExternalStore(subscribe, () => target)
}
