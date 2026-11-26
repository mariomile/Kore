import { describe, expect, it } from 'vitest'
import { applyNoteEdit } from './chat/note-edit'
import { agentDisplayName, parseAgentActivity } from './agent-activity'

function line(fields: Record<string, unknown>): string {
  return JSON.stringify({
    at: 1_000,
    agent: 'MCP',
    client: 'claude-code',
    path: 'daily/2026-11-26.md',
    ...fields,
  })
}

describe('agent activity', () => {
  it('names an unnamed agent after its client and keeps a named one', () => {
    expect(agentDisplayName('MCP', 'claude-code')).toBe('Claude Code')
    expect(agentDisplayName('MCP', 'codex-mcp-client')).toBe('Codex')
    expect(agentDisplayName('MCP', 'my_tool')).toBe('My Tool')
    expect(agentDisplayName('MCP', undefined)).toBe('Agent')
    expect(agentDisplayName('Grok', 'claude-code')).toBe('Grok')
  })

  it('turns a read and an append into events whose undo takes the append back', () => {
    const before = '# Today\n\n- first\n'
    const after = '# Today\n\n- first\n- second\n'
    const text = [
      line({ kind: 'read' }),
      line({
        kind: 'write',
        created: false,
        removed: '',
        added: '- second\n',
        contextBefore: '- first\n',
        contextAfter: '',
        at: 2_000,
      }),
      'not json',
      '',
    ].join('\n')
    const [read, write] = parseAgentActivity(text, 0)
    expect(read).toEqual({
      agent: 'Claude Code',
      kind: 'read',
      path: 'daily/2026-11-26.md',
      atMs: 1_000,
    })
    expect(write?.kind).toBe('write')
    expect(write?.lines).toEqual(['- second'])
    expect(applyNoteEdit(after, write!.undo!)).toEqual({ ok: true, after: before })
  })

  it('anchors an edit at the top of a note on the line after it', () => {
    const [write] = parseAgentActivity(
      line({
        kind: 'write',
        removed: 'old\n',
        added: 'new\n',
        contextBefore: '',
        contextAfter: 'rest\n',
      }),
      0,
    )
    expect(applyNoteEdit('new\nrest\n', write!.undo!)).toEqual({ ok: true, after: 'old\nrest\n' })
  })

  it('offers no undo for a note the agent created and drops history', () => {
    const created = line({ kind: 'write', created: true, added: '# Plan\n', at: 5_000 })
    const old = line({ kind: 'read', at: 10 })
    const events = parseAgentActivity([old, created].join('\n'), 1_000)
    expect(events).toHaveLength(1)
    expect(events[0]?.undo).toBeUndefined()
    expect(events[0]?.lines).toEqual(['# Plan'])
  })

  it('takes back an append exactly as kore mcp logged it', () => {
    // Recorded from a real stdio session (`append_to_note` on a daily).
    const logged =
      '{"added":"\\nSend Sarah the beta feedback summary before Friday\\n","agent":"MCP","at":1795732723248,"client":"claude-code","contextAfter":"","contextBefore":"- Morning review with [[Sarah Chen]]\\n","created":false,"kind":"write","path":"daily/2026-11-26.md","removed":""}'
    const before = '- Morning review with [[Sarah Chen]]\n'
    const after = `${before}\nSend Sarah the beta feedback summary before Friday\n`
    const [write] = parseAgentActivity(logged, 0)
    expect(write?.agent).toBe('Claude Code')
    expect(write?.lines).toEqual(['Send Sarah the beta feedback summary before Friday'])
    expect(applyNoteEdit(after, write!.undo!)).toEqual({ ok: true, after: before })
  })
})
