import { afterEach, describe, expect, it } from 'vitest'
import { setBridge } from '../ipc/bridge'
import { commitAgentWrites } from './agent-commits'

afterEach(() => {
  setBridge(null)
})

const COMMITTED = { committed: true, sha: 'abc', ahead: 1, skippedLargeFiles: [] }

describe('commitAgentWrites', () => {
  it('commits each agent’s notes under its name, then clears what it read', async () => {
    const calls: { command: string; args: Record<string, unknown> }[] = []
    setBridge({
      invoke: async (command, args) => {
        calls.push({ command, args })
        if (command === 'git_agent_writes') {
          return {
            writes: [
              { at: 1, agent: 'Grok', email: 'grok@agents.kore', path: 'daily/2026-11-08.md' },
              { at: 2, agent: 'Claude Code', email: 'claude-code@agents.kore', path: 'notes/a.md' },
              { at: 3, agent: 'Grok', email: 'grok@agents.kore', path: 'daily/2026-11-08.md' },
            ],
            lines: 4,
          }
        }
        return command === 'git_commit_paths' ? COMMITTED : null
      },
      listen: async () => () => {},
    })

    expect(await commitAgentWrites(3)).toBe(true)
    expect(calls.map((call) => call.command)).toEqual([
      'git_agent_writes',
      'git_commit_paths',
      'git_commit_paths',
      'git_agent_writes_clear',
    ])
    expect(calls[1]!.args).toMatchObject({
      paths: ['daily/2026-11-08.md'],
      authorName: 'Grok',
      authorEmail: 'grok@agents.kore',
      trailer: 'Kore-Agent: Grok',
      generation: 3,
    })
    expect(calls[2]!.args).toMatchObject({
      paths: ['notes/a.md'],
      authorEmail: 'claude-code@agents.kore',
    })
    expect(calls[3]!.args).toMatchObject({ lines: 4 })
  })

  it('keeps the journal when a commit fails', async () => {
    const commands: string[] = []
    setBridge({
      invoke: async (command) => {
        commands.push(command)
        if (command === 'git_agent_writes') {
          return {
            writes: [{ at: 1, agent: 'Grok', email: 'grok@agents.kore', path: 'notes/a.md' }],
            lines: 1,
          }
        }
        throw new Error('repository locked')
      },
      listen: async () => () => {},
    })

    expect(await commitAgentWrites(3)).toBe(false)
    expect(commands).not.toContain('git_agent_writes_clear')
  })
})
