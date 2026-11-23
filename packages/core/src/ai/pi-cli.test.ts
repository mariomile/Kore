import { afterEach, describe, expect, it } from 'vitest'
import { setBridge } from '../ipc/bridge'
import type { HostToolRunner } from './chat/host-tools'
import type { ChatStreamEvent } from './chat/stream-chat'
import { SUPPORT_FILE_ARG } from './agent-cli'
import {
  createPiCliSession,
  piCliArgs,
  piPromptLine,
  piSteerLine,
  streamPiCliChat,
  PI_CLI_DEFAULT_MODEL,
  PI_EXTENSION_FILE,
  PI_TOOLS_ENV,
} from './pi-cli'

afterEach(() => {
  setBridge(null)
})

/** A runner with one `search_notes` tool that answers a fixed hit. */
function searchRunner(): HostToolRunner {
  return {
    specs: [{ name: 'search_notes', description: 'Search notes', parameters: { type: 'object' } }],
    describe: async (request) => ({
      tool: 'search',
      toolCallId: request.toolCallId,
      query: 'roadmap',
    }),
    run: async (request) =>
      request.name === 'search_notes'
        ? {
            ok: true,
            output: { hits: [{ path: 'notes/roadmap.md', title: 'Roadmap' }] },
            result: {
              tool: 'search',
              toolCallId: request.toolCallId,
              query: 'roadmap',
              hits: [{ path: 'notes/roadmap.md', title: 'Roadmap' }],
            },
          }
        : { ok: false, error: `Unknown tool: ${request.name}` },
  }
}

// Records as pi 1.6.0 writes them in RPC mode (trimmed to the fields read).
const TOOL_START = JSON.stringify({
  type: 'tool_execution_start',
  toolCallId: 'call_1',
  toolName: 'search_notes',
  args: { query: 'roadmap' },
})
function toolRequest(name: string): string {
  return JSON.stringify({
    type: 'extension_ui_request',
    id: 'ui-1',
    method: 'input',
    title: 'kore-tool',
    placeholder: JSON.stringify({ toolCallId: 'call_1', name, input: { query: 'roadmap' } }),
  })
}
function textDelta(delta: string): string {
  return JSON.stringify({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta },
  })
}
const assistantStart = JSON.stringify({
  type: 'message_start',
  message: { role: 'assistant', content: [] },
})
const SETTLED = JSON.stringify({ type: 'agent_settled', aborted: false })

describe('piCliArgs', () => {
  it('runs RPC with nothing of pi’s own but the Kore extension', () => {
    const args = piCliArgs({ model: PI_CLI_DEFAULT_MODEL, systemPrompt: 'You are Kore.' })
    expect(args.slice(0, 3)).toEqual(['--mode', 'rpc', '--no-session'])
    for (const flag of [
      '--no-extensions',
      '--no-builtin-tools',
      '--no-skills',
      '--no-context-files',
      '--no-approve',
    ]) {
      expect(args).toContain(flag)
    }
    expect(args[args.indexOf('--extension') + 1]).toBe(SUPPORT_FILE_ARG)
    expect(args).not.toContain('--model')
    expect(args.at(-1)).toBe('You are Kore.')
  })

  it('names the model only when one was picked', () => {
    const args = piCliArgs({ model: 'anthropic/claude-sonnet-5', systemPrompt: '' })
    expect(args[args.indexOf('--model') + 1]).toBe('anthropic/claude-sonnet-5')
  })
})

describe('pi stdin lines', () => {
  it('sends the prompt with images and a steer as RPC commands', () => {
    expect(JSON.parse(piPromptLine('hello'))).toEqual({
      id: 'prompt',
      type: 'prompt',
      message: 'hello',
    })
    const withImage = JSON.parse(
      piPromptLine('look', [
        {
          label: 'Attachment 1: a.png',
          name: 'a.png',
          mediaType: 'image/png',
          channel: 'image',
          base64: 'AAAA',
        },
      ]),
    ) as { images: unknown[] }
    expect(withImage.images).toEqual([{ type: 'image', data: 'AAAA', mimeType: 'image/png' }])
    expect(JSON.parse(piSteerLine('wait'))).toEqual({ type: 'steer', message: 'wait' })
  })
})

describe('createPiCliSession', () => {
  it('shows a tool call at once, runs it in the app and answers pi', async () => {
    const session = createPiCliSession(searchRunner())
    const sent: string[] = []
    const send = async (line: string): Promise<void> => {
      sent.push(line)
    }

    await session.onRawLine(TOOL_START, send)
    expect(session.parseLine(TOOL_START)).toEqual([
      {
        type: 'event',
        event: { type: 'tool-call', call: expect.objectContaining({ tool: 'search' }) },
      },
    ])
    expect(sent).toEqual([])

    const request = toolRequest('search_notes')
    await session.onRawLine(request, send)
    expect(session.parseLine(request)).toEqual([
      {
        type: 'event',
        event: { type: 'tool-result', result: expect.objectContaining({ tool: 'search' }) },
      },
    ])
    expect(JSON.parse(sent[0] ?? '')).toEqual({
      type: 'extension_ui_response',
      id: 'ui-1',
      value: JSON.stringify({ output: { hits: [{ path: 'notes/roadmap.md', title: 'Roadmap' }] } }),
    })
  })

  it('relays a refused call to pi and the transcript as an error', async () => {
    const session = createPiCliSession(searchRunner())
    const sent: string[] = []
    const request = toolRequest('delete_everything')
    await session.onRawLine(request, async (line) => {
      sent.push(line)
    })
    expect(session.parseLine(request)).toEqual([
      {
        type: 'event',
        event: {
          type: 'tool-error',
          toolCallId: 'call_1',
          message: 'Unknown tool: delete_everything',
        },
      },
    ])
    expect(JSON.parse(sent[0] ?? '')).toMatchObject({
      value: JSON.stringify({ error: 'Unknown tool: delete_everything' }),
    })
  })

  it('cancels any other dialog so pi never waits on a missing UI', async () => {
    const session = createPiCliSession(searchRunner())
    const sent: string[] = []
    await session.onRawLine(
      JSON.stringify({
        type: 'extension_ui_request',
        id: 'ui-2',
        method: 'confirm',
        title: 'Sure?',
      }),
      async (line) => {
        sent.push(line)
      },
    )
    expect(sent.map((line) => JSON.parse(line) as unknown)).toEqual([
      { type: 'extension_ui_response', id: 'ui-2', cancelled: true },
    ])
  })

  it('streams text, separates assistant messages and settles the turn', () => {
    const session = createPiCliSession(searchRunner())
    expect(session.parseLine(assistantStart)).toEqual([])
    expect(session.parseLine(textDelta('Let me look.'))).toEqual([
      { type: 'text-delta', text: 'Let me look.' },
    ])
    expect(session.parseLine(assistantStart)).toEqual([])
    expect(session.parseLine(textDelta('Found it.'))).toEqual([
      { type: 'text-delta', text: '\n\nFound it.' },
    ])
    expect(session.parseLine(SETTLED)).toEqual([{ type: 'result', isError: false, message: null }])
  })

  it('reports the last assistant error, and a steer pi delivered', () => {
    const session = createPiCliSession(searchRunner())
    const user = (text: string): string =>
      JSON.stringify({
        type: 'message_start',
        message: { role: 'user', content: [{ type: 'text', text }] },
      })
    expect(session.parseLine(user('first'))).toEqual([])
    expect(session.parseLine(user('actually, weekly'))).toEqual([
      { type: 'event', event: { type: 'steer', text: 'actually, weekly' } },
    ])
    session.parseLine(
      JSON.stringify({
        type: 'message_end',
        message: { role: 'assistant', stopReason: 'error', errorMessage: 'No credentials.' },
      }),
    )
    expect(session.parseLine(SETTLED)).toEqual([
      { type: 'result', isError: true, message: 'No credentials.' },
    ])
  })
})

describe('streamPiCliChat', () => {
  it('runs a whole turn: prompt in, tool answered on stdin, reply out', async () => {
    const lines = [
      assistantStart,
      textDelta('Let me look.'),
      TOOL_START,
      toolRequest('search_notes'),
      assistantStart,
      textDelta('Found it.'),
      SETTLED,
    ]
    let emit: (payload: unknown) => void = () => {}
    const sent: string[] = []
    let run: Record<string, unknown> = {}
    setBridge({
      invoke: async (command, args) => {
        const payload = (args ?? {}) as Record<string, unknown>
        const requestId = String(payload['requestId'])
        if (command === 'agent_cli_run') {
          run = payload
          queueMicrotask(() => {
            for (const line of lines) {
              emit({ kind: 'line', requestId, line })
            }
          })
        } else if (command === 'agent_cli_send') {
          sent.push(String(payload['line']))
        } else if (command === 'agent_cli_stdin_close') {
          emit({ kind: 'done', requestId, code: 0 })
        }
        return null
      },
      listen: async (_event, handler) => {
        emit = handler
        return () => {}
      },
    })

    const events: ChatStreamEvent[] = []
    for await (const event of streamPiCliChat({
      model: PI_CLI_DEFAULT_MODEL,
      instructions: 'You are Kore.',
      messages: [{ role: 'user', content: 'find the roadmap' }],
      tools: searchRunner(),
    })) {
      events.push(event)
    }

    expect(run['binary']).toBe('pi')
    expect(run['cwd']).toBeNull()
    expect(run['supportFile']).toMatchObject({ fileName: PI_EXTENSION_FILE })
    expect(run['env']).toEqual({ [PI_TOOLS_ENV]: JSON.stringify(searchRunner().specs) })
    expect(JSON.parse(String(run['prompt']))).toMatchObject({
      type: 'prompt',
      message: 'find the roadmap',
    })
    expect(sent).toHaveLength(1)
    expect(events.map((event) => event.type)).toEqual([
      'text-delta',
      'tool-call',
      'tool-result',
      'text-delta',
      'complete',
    ])
    expect(events.at(-1)).toEqual({
      type: 'complete',
      messages: [
        { role: 'assistant', content: [{ type: 'text', text: 'Let me look.\n\nFound it.' }] },
      ],
    })
  })
})
