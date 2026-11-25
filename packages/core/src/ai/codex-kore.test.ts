import { afterEach, describe, expect, it } from 'vitest'
import type { ModelMessage } from 'ai'
import { setBridge } from '../ipc/bridge'
import { fakeHostTools } from './chat/host-tools.fixtures'
import type { ChatStreamEvent } from './chat/stream-chat'
import { codexKoreArgs, streamCodexKoreChat } from './codex-kore'

afterEach(() => {
  setBridge(null)
})

describe('codexKoreArgs', () => {
  it('runs app-server with no shell and a profile that reads no files', () => {
    const args = codexKoreArgs([])
    expect(args[0]).toBe('app-server')
    for (const feature of ['plugins', 'shell_tool', 'unified_exec']) {
      expect(args[args.indexOf(feature) - 1]).toBe('--disable')
    }
    expect(args).toContain('default_permissions="kore_tools"')
    expect(args).toContain('permissions.kore_tools.filesystem={ ":minimal" = "read" }')
  })

  it('mounts the user’s MCP servers', () => {
    const args = codexKoreArgs([
      { name: 'github', transport: { kind: 'http', url: 'https://x' }, env: {} },
    ])
    expect(args.join(' ')).toContain('mcp_servers.github')
  })
})

describe('streamCodexKoreChat', () => {
  interface FakeCli {
    runs: Record<string, unknown>[]
    sends: string[]
    emit: ((payload: unknown) => void) | null
  }

  function installFakeCli(): FakeCli {
    const fake: FakeCli = { runs: [], sends: [], emit: null }
    setBridge({
      invoke: async (command, args) => {
        if (command === 'agent_cli_run') {
          fake.runs.push(args)
        } else if (command === 'agent_cli_send') {
          fake.sends.push(String(args['line']))
        }
        return null
      },
      listen: async (_event, handler) => {
        fake.emit = handler
        return () => {
          fake.emit = null
        }
      },
    })
    return fake
  }

  async function settle(until: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 50 && !until(); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }

  it('declares Kore’s tools and answers the app-server’s tool calls through them', async () => {
    const fake = installFakeCli()
    const requests: unknown[] = []
    const stream = streamCodexKoreChat({
      model: 'default',
      instructions: 'Kore prompt',
      messages: [{ role: 'user', content: 'read my diary' }] as ModelMessage[],
      tools: fakeHostTools(async (request) => {
        requests.push(request)
        return { ok: false, error: 'This note is private.' }
      }),
      mcpServers: [],
    })
    const events: ChatStreamEvent[] = []
    const drained = (async () => {
      for await (const event of stream) {
        events.push(event)
      }
    })()
    await settle(() => fake.emit !== null && fake.runs.length > 0)

    const run = fake.runs[0] ?? {}
    expect(run['cwd']).toBeNull()
    const prompt = String(run['prompt'])
    expect(prompt).toContain('"experimentalApi":true')
    expect(prompt).toContain('"baseInstructions":"Kore prompt"')
    expect(prompt).toContain(
      '"dynamicTools":[{"type":"function","name":"read_note","description":"Read a note","inputSchema":{"type":"object"}}]',
    )

    const requestId = String(run['requestId'])
    const line = (payload: unknown) =>
      fake.emit?.({ kind: 'line', requestId, line: JSON.stringify(payload) })
    line({ id: 2, result: { thread: { id: 'thr_1' } } })
    await settle(() => fake.sends.length > 0)
    expect(fake.sends[0]).toContain('"method":"turn/start"')

    line({
      id: 0,
      method: 'item/tool/call',
      params: { callId: 'call_1', tool: 'read_note', arguments: { title: 'Diary' } },
    })
    await settle(() => fake.sends.length > 1)
    expect(requests).toEqual([
      { toolCallId: 'call_1', name: 'read_note', input: { title: 'Diary' } },
    ])
    expect(JSON.parse(fake.sends[1] ?? 'null')).toEqual({
      id: 0,
      result: {
        contentItems: [{ type: 'inputText', text: 'This note is private.' }],
        success: false,
      },
    })

    line({ method: 'item/agentMessage/delta', params: { itemId: 'i1', delta: 'It is private.' } })
    line({ method: 'turn/completed', params: { turn: { id: 'turn_1', status: 'completed' } } })
    fake.emit?.({ kind: 'done', requestId, code: 0 })
    await drained

    expect(events.slice(0, 3)).toEqual([
      { type: 'tool-call', call: { id: 'call_1', kind: 'read' } },
      { type: 'tool-error', toolCallId: 'call_1', message: 'This note is private.' },
      { type: 'text-delta', text: 'It is private.' },
    ])
    expect(events.at(-1)?.type).toBe('complete')
  })
})
