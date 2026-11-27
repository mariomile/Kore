import type { NoteEdit } from './chat/note-edit'

/**
 * Agents seen working in the vault right now: which notes an outside agent
 * (Claude Code, Codex, any MCP client) is reading, what it just wrote, and
 * how to take that back. The app draws it live (a presence pill, the
 * agent's lines shaded in the note, Undo next to them); this module only
 * folds the events into that picture and decides when it goes stale.
 *
 * Events come from the vault's live channel (the `kore mcp` process telling
 * the app what it touches); until that exists the dev harness scripts them.
 */
export interface AgentPresenceEvent {
  /** The agent's display name, as its key or client names it ("Claude Code"). */
  readonly agent: string
  readonly kind: 'read' | 'write' | 'done'
  /** The note read or written; absent on `done`. */
  readonly path?: string
  /** The note's title, when the channel knows it (the index does). */
  readonly title?: string
  /** For a write: the body lines it added, so the note can shade them. */
  readonly lines?: readonly string[]
  /** For a write: the edit that takes it back. */
  readonly undo?: NoteEdit
  readonly atMs: number
}

export interface AgentWrite {
  readonly path: string
  readonly lines: readonly string[]
  readonly undo: NoteEdit | null
  readonly atMs: number
}

export type AgentStatus = 'reading' | 'writing' | 'idle'

export interface AgentPresence {
  readonly agent: string
  readonly status: AgentStatus
  /** The note it is on now; null once it went quiet or said it is done. */
  readonly current: string | null
  /** Notes it read recently, newest first. */
  readonly reading: readonly string[]
  /** What it wrote this sitting, oldest first. */
  readonly writes: readonly AgentWrite[]
  /** Titles of the notes it touched, by path, as the channel named them. */
  readonly titles: Readonly<Record<string, string>>
  readonly lastAtMs: number
}

/** A read stays lit this long after the agent touched the note. */
export const AGENT_READ_GLOW_MS = 6_000
/** An agent that says nothing for this long is shown as idle. */
export const AGENT_IDLE_AFTER_MS = 12_000

interface AgentState {
  current: string | null
  done: boolean
  reads: Map<string, number>
  writes: AgentWrite[]
  titles: Record<string, string>
  lastAtMs: number
}

export interface AgentPresenceStore {
  apply(event: AgentPresenceEvent): void
  /** Forget one write (it was undone). */
  dropWrite(agent: string, write: AgentWrite): void
  snapshot(nowMs: number): readonly AgentPresence[]
  subscribe(listener: () => void): () => void
}

export function createAgentPresenceStore(): AgentPresenceStore {
  const agents = new Map<string, AgentState>()
  const listeners = new Set<() => void>()
  const notify = (): void => {
    for (const listener of listeners) {
      listener()
    }
  }

  return {
    apply(event) {
      const previous = agents.get(event.agent)
      // A new sitting starts when the agent comes back after it went idle
      // with nothing left to undo; otherwise this event extends the current one.
      const ended =
        previous !== undefined &&
        previous.writes.length === 0 &&
        (previous.done || event.atMs - previous.lastAtMs > AGENT_IDLE_AFTER_MS)
      const state: AgentState = (ended ? undefined : previous) ?? {
        current: null,
        done: false,
        reads: new Map(),
        writes: [],
        titles: {},
        lastAtMs: event.atMs,
      }
      state.lastAtMs = event.atMs
      state.done = event.kind === 'done'
      state.current = event.kind === 'done' ? null : (event.path ?? null)
      if (event.path !== undefined && event.title !== undefined) {
        state.titles[event.path] = event.title
      }
      if (event.kind === 'read' && event.path !== undefined) {
        state.reads.set(event.path, event.atMs)
      }
      if (event.kind === 'write' && event.path !== undefined) {
        state.writes.push({
          path: event.path,
          lines: event.lines ?? [],
          undo: event.undo ?? null,
          atMs: event.atMs,
        })
      }
      agents.set(event.agent, state)
      notify()
    },
    dropWrite(agent, write) {
      const state = agents.get(agent)
      if (state === undefined) {
        return
      }
      state.writes = state.writes.filter((entry) => entry !== write)
      notify()
    },
    snapshot(nowMs) {
      const out: AgentPresence[] = []
      for (const [agent, state] of agents) {
        const quietMs = nowMs - state.lastAtMs
        const idle = state.done || quietMs > AGENT_IDLE_AFTER_MS
        // Nothing left to undo: an idle agent lingers only long enough to be
        // read ("Read 3 notes"), then leaves the picture.
        if (idle && state.writes.length === 0 && quietMs > AGENT_READ_GLOW_MS) {
          continue
        }
        const lastWrite = state.writes.at(-1)
        const status: AgentStatus = idle
          ? 'idle'
          : lastWrite !== undefined && lastWrite.atMs === state.lastAtMs
            ? 'writing'
            : 'reading'
        const reading = [...state.reads]
          .filter(([, atMs]) => nowMs - atMs <= AGENT_READ_GLOW_MS && !idle)
          .sort((a, b) => b[1] - a[1])
          .map(([path]) => path)
        out.push({
          agent,
          status,
          current: idle ? null : state.current,
          reading,
          writes: state.writes,
          titles: state.titles,
          lastAtMs: state.lastAtMs,
        })
      }
      return out.sort((a, b) => b.lastAtMs - a.lastAtMs)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
