import { useSyncExternalStore } from 'react'
import { createAgentPresenceStore, type AgentPresence } from '@kore/core'

/**
 * The app's one picture of agents working in the vault (core's
 * `createAgentPresenceStore`), shared by the presence pill, the note
 * shading and the sidebar. Module scope because every pane and both
 * surfaces read the same agents, and one clock serves them all: it ticks
 * only while an agent is present, so reads fade and quiet agents turn idle
 * without a new event, and costs nothing otherwise.
 */
export const agentPresenceStore = createAgentPresenceStore()

const TICK_MS = 1_000
const EMPTY: readonly AgentPresence[] = []

let picture: readonly AgentPresence[] = EMPTY
let pictureKey = '[]'
let timer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<() => void>()

function refresh(): void {
  const next = agentPresenceStore.snapshot(Date.now())
  // The clock re-reads every second, but a tick that changed nothing (no
  // read faded, nobody went idle) must not re-render every row and editor.
  const key = JSON.stringify(next, (name, value: unknown) =>
    name === 'lastAtMs' ? undefined : value,
  )
  const changed = key !== pictureKey
  pictureKey = key
  if (changed) {
    picture = next.length === 0 ? EMPTY : next
  }
  if (picture.length > 0 && timer === null) {
    timer = setInterval(refresh, TICK_MS)
  } else if (picture.length === 0 && timer !== null) {
    clearInterval(timer)
    timer = null
  }
  if (changed) {
    for (const listener of listeners) {
      listener()
    }
  }
}

agentPresenceStore.subscribe(refresh)

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Agents in the vault now, newest activity first. */
export function useAgentPresence(): readonly AgentPresence[] {
  return useSyncExternalStore(subscribe, () => picture)
}

/** The agent reading `path` right now, if any (a string, so rows re-render only on change). */
export function useAgentReading(path: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => picture.find((agent) => agent.reading.includes(path))?.agent ?? null,
  )
}
