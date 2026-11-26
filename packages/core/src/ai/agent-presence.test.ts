import { describe, expect, it } from 'vitest'
import { AGENT_IDLE_AFTER_MS, createAgentPresenceStore } from './agent-presence'

describe('agent presence', () => {
  it('follows an agent from reading to writing to idle with its writes kept for undo', () => {
    const store = createAgentPresenceStore()
    store.apply({ agent: 'Claude Code', kind: 'read', path: 'a.md', title: 'A', atMs: 0 })
    expect(store.snapshot(100)[0]).toMatchObject({
      status: 'reading',
      current: 'a.md',
      reading: ['a.md'],
    })

    const undo = { oldText: 'x\n', newText: '' }
    store.apply({
      agent: 'Claude Code',
      kind: 'write',
      path: 'b.md',
      lines: ['x'],
      undo,
      atMs: 200,
    })
    expect(store.snapshot(300)[0]).toMatchObject({ status: 'writing', current: 'b.md' })

    store.apply({ agent: 'Claude Code', kind: 'done', atMs: 400 })
    const idle = store.snapshot(60_000)[0]!
    expect(idle).toMatchObject({ status: 'idle', current: null, reading: [] })
    expect(idle.writes).toEqual([{ path: 'b.md', lines: ['x'], undo, atMs: 200 }])

    store.dropWrite('Claude Code', idle.writes[0]!)
    expect(store.snapshot(60_000)).toEqual([])
  })

  it('starts a new sitting when an agent with nothing to undo comes back', () => {
    const store = createAgentPresenceStore()
    store.apply({ agent: 'Codex', kind: 'read', path: 'a.md', title: 'A', atMs: 0 })
    store.apply({
      agent: 'Codex',
      kind: 'read',
      path: 'b.md',
      title: 'B',
      atMs: AGENT_IDLE_AFTER_MS + 1,
    })
    expect(store.snapshot(AGENT_IDLE_AFTER_MS + 2)[0]!.titles).toEqual({ 'b.md': 'B' })
  })
})
