import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-react'
import { agentActivitySince } from '@kore/core'
import { agentPresenceStore } from '@/lib/agent-presence'
import { AgentActivityFeed } from './agent-activity-feed'

vi.mock('@kore/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kore/core')>()),
  agentActivitySince: vi.fn(),
}))

afterEach(async () => {
  await cleanup()
  vi.clearAllMocks()
})

it('feeds what kore mcp logged into the presence picture and tails from where it stopped', async () => {
  const now = Date.now()
  // Shaped like a real `kore mcp` stdio session from Claude Code.
  const log = [
    { agent: 'MCP', at: now - 200, client: 'claude-code', kind: 'read', path: 'daily/today.md' },
    {
      agent: 'MCP',
      at: now - 100,
      client: 'claude-code',
      kind: 'write',
      path: 'daily/today.md',
      created: false,
      removed: '',
      added: '\nSend Sarah the beta feedback summary\n',
      contextBefore: '- Morning review\n',
      contextAfter: '',
    },
    { agent: 'MCP', at: now - 3_600_000, client: 'codex', kind: 'read', path: 'old.md' },
  ]
  const text = `${log.map((line) => JSON.stringify(line)).join('\n')}\n`
  vi.mocked(agentActivitySince)
    .mockResolvedValueOnce({ text, offset: text.length })
    .mockResolvedValue({ text: '', offset: text.length })

  await render(<AgentActivityFeed generation={7} />)

  await expect
    .poll(() => agentPresenceStore.snapshot(Date.now()).map((agent) => agent.agent))
    .toEqual(['Claude Code'])
  const [agent] = agentPresenceStore.snapshot(Date.now())
  expect(agent?.writes).toHaveLength(1)
  expect(agent?.writes[0]?.lines).toEqual(['Send Sarah the beta feedback summary'])
  expect(agent?.writes[0]?.undo).toEqual({
    oldText: '- Morning review\n\nSend Sarah the beta feedback summary\n',
    newText: '- Morning review\n',
  })
  expect(vi.mocked(agentActivitySince).mock.calls[0]).toEqual([0, 7])
  await expect.poll(() => vi.mocked(agentActivitySince).mock.calls.length).toBeGreaterThan(1)
  expect(vi.mocked(agentActivitySince).mock.calls[1]).toEqual([text.length, 7])
  agentPresenceStore.dropWrite('Claude Code', agent!.writes[0]!)
})

it('stops quietly when the host has no log to read', async () => {
  vi.mocked(agentActivitySince).mockRejectedValue(new Error('no vault'))
  await render(<AgentActivityFeed generation={1} />)
  await new Promise((resolve) => setTimeout(resolve, 1_300))
  expect(agentActivitySince).toHaveBeenCalledTimes(1)
})
