import { afterEach, describe, expect, it } from 'vitest'
import { setBridge } from '../ipc/bridge'
import { listCliModels } from './cli-models'

afterEach(() => {
  setBridge(null)
})

/** A CLI that prints `lines` once started and records each spawn and stop. */
function installFakeCli(lines: unknown[]) {
  const fake = { runs: [] as Record<string, unknown>[], stops: 0 }
  let emit: ((payload: unknown) => void) | null = null
  setBridge({
    invoke: async (command, args) => {
      if (command === 'agent_cli_run') {
        fake.runs.push(args)
        const requestId = args['requestId']
        setTimeout(() => {
          for (const line of lines) {
            emit?.({ kind: 'line', requestId, line: JSON.stringify(line) })
          }
        }, 0)
      } else if (command === 'agent_cli_stop') {
        fake.stops += 1
        emit?.({ kind: 'done', requestId: args['requestId'], code: null })
      }
      return null
    },
    listen: async (_event, handler) => {
      emit = handler
      return () => {
        emit = null
      }
    },
  })
  return fake
}

describe('listCliModels', () => {
  it('reads Claude Code’s models from its initialize answer, default first', async () => {
    const fake = installFakeCli([
      { type: 'system', subtype: 'init' },
      {
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: 'models',
          response: {
            models: [
              { value: 'default', displayName: 'Default (recommended)' },
              { value: 'opus', displayName: 'Opus 5.5' },
              { value: 'haiku', displayName: 'Haiku 5.5' },
            ],
          },
        },
      },
    ])
    expect(await listCliModels('claude-cli')).toEqual([
      { id: 'default', label: 'CLI default', contextWindow: 200_000 },
      { id: 'opus', label: 'Opus 5.5', contextWindow: 200_000 },
      { id: 'haiku', label: 'Haiku 5.5', contextWindow: 200_000 },
    ])
    expect(String(fake.runs[0]?.['prompt'])).toContain('"subtype":"initialize"')
    expect(fake.runs[0]?.['keepStdinOpen']).toBe(true)
    // The process is stopped once the answer is in.
    expect(fake.stops).toBe(1)
  })

  it('reads Codex’s visible models from app-server model/list', async () => {
    const fake = installFakeCli([
      { id: 1, result: {} },
      {
        id: 2,
        result: {
          data: [
            { model: 'gpt-6.2-sol', displayName: 'GPT-6.2-Sol', hidden: false },
            { model: 'internal', displayName: 'Internal', hidden: true },
          ],
        },
      },
    ])
    expect(await listCliModels('codex-cli')).toEqual([
      { id: 'default', label: 'CLI default', contextWindow: 200_000 },
      { id: 'gpt-6.2-sol', label: 'GPT-6.2-Sol', contextWindow: 200_000 },
    ])
    expect(fake.runs[0]).toMatchObject({ binary: 'codex', isolatedCodexHome: true })
  })

  it('keeps the catalog when the CLI ends without an answer', async () => {
    let emit: ((payload: unknown) => void) | null = null
    setBridge({
      invoke: async (command, args) => {
        if (command === 'agent_cli_run') {
          setTimeout(() => emit?.({ kind: 'done', requestId: args['requestId'], code: 1 }), 0)
        }
        return null
      },
      listen: async (_event, handler) => {
        emit = handler
        return () => {}
      },
    })
    expect(await listCliModels('claude-cli')).toBeNull()
    expect(await listCliModels('cursor-cli')).toBeNull()
  })
})
