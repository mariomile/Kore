import { useSyncExternalStore } from 'react'
import type { RemoteAccessState } from '@reflect/core'

/**
 * Where remote access stands, shared by the invisible runner that starts and
 * stops it ({@link RemoteAccessRunner}) and the settings field that shows it.
 */
export type RemoteAccessPhase =
  | { readonly kind: 'off' }
  | { readonly kind: 'starting' }
  | { readonly kind: 'on'; readonly state: RemoteAccessState }
  | { readonly kind: 'error'; readonly message: string }

interface Snapshot {
  readonly phase: RemoteAccessPhase
  /** Bumped to ask the runner for a restart (new token, "Try again"). */
  readonly restarts: number
}

let snapshot: Snapshot = { phase: { kind: 'off' }, restarts: 0 }
const listeners = new Set<() => void>()

function publish(next: Snapshot): void {
  snapshot = next
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function read(): Snapshot {
  return snapshot
}

export function setRemoteAccessPhase(phase: RemoteAccessPhase): void {
  publish({ ...snapshot, phase })
}

export function remoteAccessPhase(): RemoteAccessPhase {
  return snapshot.phase
}

/** Restart the server with the current settings and token. */
export function requestRemoteAccessRestart(): void {
  publish({ ...snapshot, restarts: snapshot.restarts + 1 })
}

export function useRemoteAccess(): Snapshot {
  return useSyncExternalStore(subscribe, read, read)
}

let queue: Promise<void> = Promise.resolve()

/**
 * Run start/stop steps one at a time: a toggle flipped while a start is in
 * flight must not let its stop overtake that start.
 */
export function enqueueRemoteAccess(step: () => Promise<void>): void {
  queue = queue.then(step, step)
}
