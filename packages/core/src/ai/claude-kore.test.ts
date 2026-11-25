import { describe, expect, it } from 'vitest'
import type { HostToolRunner } from './chat/host-tools'
import type { NoteToolCall } from './chat/tools-activity'
import { claudeKoreArgs, createClaudeKoreSession, KORE_MCP_SERVER } from './claude-kore'

const readNote = { toolCallId: '', name: 'read_note', input: {} }

function fakeTools(run: HostToolRunner['run']): HostToolRunner {
  return {
    specs: [{ name: 'read_note', description: 'Read a note', parameters: { type: 'object' } }],
    describe: async (request) =>
      ({ id: request.toolCallId, kind: 'read' }) as unknown as NoteToolCall,
    run,
  }
}

function controlLine(requestId: string, message: Record<string, unknown>): string {
  return JSON.stringify({
    type: 'control_request',
    request_id: requestId,
    request: { subtype: 'mcp_message', server_name: KORE_MCP_SERVER, message },
  })
}

async function answer(
  session: ReturnType<typeof createClaudeKoreSession>,
  line: string,
): Promise<Record<string, unknown>> {
  const sent: string[] = []
  await session.onRawLine(line, async (reply) => {
    sent.push(reply)
  })
  expect(sent).toHaveLength(1)
  return JSON.parse(sent[0] ?? 'null') as Record<string, unknown>
}

describe('createClaudeKoreSession', () => {
  it('lists Kore’s tools to the CLI as an MCP server', async () => {
    const session = createClaudeKoreSession(fakeTools(async () => ({ ok: false, error: '' })))
    const reply = await answer(
      session,
      controlLine('r1', { jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    )
    expect(reply).toEqual({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'r1',
        response: {
          mcp_response: {
            jsonrpc: '2.0',
            id: 1,
            result: {
              tools: [
                { name: 'read_note', description: 'Read a note', inputSchema: { type: 'object' } },
              ],
            },
          },
        },
      },
    })
  })

  it('runs a call, answers it, and shows it as the chat engine’s tool events', async () => {
    const requests: unknown[] = []
    const session = createClaudeKoreSession(
      fakeTools(async (request) => {
        requests.push(request)
        return { ok: false, error: 'This note is private.' }
      }),
    )
    const reply = await answer(
      session,
      controlLine('r2', {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'read_note',
          arguments: { title: 'Diary' },
          _meta: { 'claudecode/toolUseId': 'toolu_1' },
        },
      }),
    )
    expect(requests).toEqual([{ ...readNote, toolCallId: 'toolu_1', input: { title: 'Diary' } }])
    expect(reply).toMatchObject({
      response: {
        response: {
          mcp_response: {
            id: 2,
            result: { content: [{ type: 'text', text: 'This note is private.' }], isError: true },
          },
        },
      },
    })
    // The assistant's tool_use for a Kore tool is not a generic step.
    const assistant = JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'mcp__kore__read_note', input: {} }],
      },
    })
    expect(session.parseLine(assistant)).toEqual([
      { type: 'event', event: { type: 'tool-call', call: { id: 'toolu_1', kind: 'read' } } },
      {
        type: 'event',
        event: { type: 'tool-error', toolCallId: 'toolu_1', message: 'This note is private.' },
      },
    ])
  })

  it('refuses control requests it does not serve, so the CLI never waits', async () => {
    const session = createClaudeKoreSession(fakeTools(async () => ({ ok: false, error: '' })))
    const reply = await answer(
      session,
      JSON.stringify({
        type: 'control_request',
        request_id: 'r3',
        request: { subtype: 'can_use_tool' },
      }),
    )
    expect(reply).toMatchObject({ response: { subtype: 'error', request_id: 'r3' } })
  })
})

describe('claudeKoreArgs', () => {
  it('gives the run no built-in tools and only Kore’s server plus the user’s', () => {
    const args = claudeKoreArgs({
      model: 'default',
      instructions: 'prompt',
      mcpServers: [{ name: 'github', transport: { kind: 'http', url: 'https://x' }, env: {} }],
    })
    expect(args[args.indexOf('--tools') + 1]).toBe('')
    expect(args[args.indexOf('--allowedTools') + 1]).toBe('mcp__kore,mcp__github')
    expect(JSON.parse(args[args.indexOf('--mcp-config') + 1] ?? '')).toEqual({
      mcpServers: {
        github: { type: 'http', url: 'https://x' },
        kore: { type: 'sdk', name: 'kore' },
      },
    })
    expect(args).not.toContain('--model')
  })
})
