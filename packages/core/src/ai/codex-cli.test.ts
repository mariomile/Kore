import { afterEach, describe, expect, it } from 'vitest'
import type { ModelMessage } from 'ai'
import { setBridge } from '../ipc/bridge'
import { cliProviderSteerMode } from './cli-providers'
import {
  codexAppServerHandshakePrompt,
  codexCliArgs,
  codexCliFilesystemToml,
  codexCliSystemPrompt,
  parseCodexCliLine,
  streamCodexCliChat,
  type CodexCliParseState,
} from './codex-cli'

afterEach(() => {
  setBridge(null)
})

describe('cliProviderSteerMode', () => {
  it('injects for Claude Code and Codex, queues for Cursor', () => {
    expect(cliProviderSteerMode('claude-cli')).toBe('inject')
    expect(cliProviderSteerMode('codex-cli')).toBe('inject')
    expect(cliProviderSteerMode('cursor-cli')).toBe('queue')
  })
})

describe('parseCodexCliLine', () => {
  it('streams agent-message deltas', () => {
    const state: CodexCliParseState = { sawAgentMessageDelta: false }
    const line = JSON.stringify({
      method: 'item/agentMessage/delta',
      params: { itemId: 'item_0', delta: 'Ciao' },
    })
    expect(parseCodexCliLine(line, state)).toEqual({ type: 'text-delta', text: 'Ciao' })
    expect(state.sawAgentMessageDelta).toBe(true)
  })

  it('drops the agent-message snapshot after deltas, otherwise emits a block', () => {
    const streamed: CodexCliParseState = { sawAgentMessageDelta: true }
    expect(
      parseCodexCliLine(
        JSON.stringify({
          method: 'item/completed',
          params: { item: { id: 'item_0', type: 'agentMessage', text: 'Ciao' } },
        }),
        streamed,
      ),
    ).toBeNull()
    expect(streamed.sawAgentMessageDelta).toBe(false)

    expect(
      parseCodexCliLine(
        JSON.stringify({
          method: 'item/completed',
          params: { item: { id: 'item_0', type: 'agentMessage', text: 'Ciao' } },
        }),
      ),
    ).toEqual({ type: 'text-block', text: 'Ciao' })
  })

  it('drops activity items and noise', () => {
    expect(
      parseCodexCliLine(
        JSON.stringify({
          method: 'item/completed',
          params: { item: { id: 'i', type: 'reasoning', text: 'x' } },
        }),
      ),
    ).toBeNull()
    expect(
      parseCodexCliLine(
        JSON.stringify({
          method: 'item/started',
          params: { item: { id: 'i', type: 'commandExecution', command: 'cat notes/a.md' } },
        }),
      ),
    ).toBeNull()
    expect(
      parseCodexCliLine(JSON.stringify({ method: 'thread/started', params: { thread: { id: 't' } } })),
    ).toBeNull()
    expect(parseCodexCliLine('not json')).toBeNull()
  })

  it('maps turn completion and failures to terminal results', () => {
    expect(
      parseCodexCliLine(
        JSON.stringify({
          method: 'turn/completed',
          params: { turn: { id: 'turn_1', status: 'completed' } },
        }),
      ),
    ).toEqual({
      type: 'result',
      isError: false,
      message: null,
    })
    expect(
      parseCodexCliLine(
        JSON.stringify({
          method: 'turn/completed',
          params: { turn: { id: 'turn_1', status: 'failed', error: { message: 'not logged in' } } },
        }),
      ),
    ).toEqual({ type: 'result', isError: true, message: 'not logged in' })
    expect(
      parseCodexCliLine(JSON.stringify({ method: 'error', params: { message: 'boom' } })),
    ).toEqual({
      type: 'result',
      isError: true,
      message: 'boom',
    })
    expect(
      parseCodexCliLine(JSON.stringify({ id: 2, error: { code: -32603, message: 'handshake failed' } })),
    ).toEqual({ type: 'result', isError: true, message: 'handshake failed' })
  })
})

describe('codexCliFilesystemToml', () => {
  it('grants the graph subtree and denies private notes, index, and git', () => {
    const toml = codexCliFilesystemToml('/graphs/work/', ['notes/secret.md'])
    expect(toml).toContain('"/graphs/work/**" = "read"')
    expect(toml).toContain('"/graphs/work/.reflect" = "deny"')
    expect(toml).toContain('"/graphs/work/.git" = "deny"')
    expect(toml).toContain('"/graphs/work/notes/secret.md" = "deny"')
  })

  it('edit mode grants write on the subtree while every deny stays', () => {
    const toml = codexCliFilesystemToml('/graphs/work', ['notes/secret.md'], true)
    expect(toml).toContain('"/graphs/work/**" = "write"')
    expect(toml).toContain('"/graphs/work/.reflect" = "deny"')
    expect(toml).toContain('"/graphs/work/.git" = "deny"')
    expect(toml).toContain('"/graphs/work/notes/secret.md" = "deny"')
  })

  it('forward-slashes a Windows root and escapes TOML string characters', () => {
    // A native backslash root would emit mixed-separator entries the sandbox
    // may not match — the deny list must not silently weaken off POSIX.
    const toml = codexCliFilesystemToml(String.raw`C:\graphs\work`, ['notes/"odd".md'])
    expect(toml).toContain('"C:/graphs/work/**" = "read"')
    expect(toml).toContain(String.raw`"C:/graphs/work/notes/\"odd\".md" = "deny"`)
  })
})

describe('codexCliArgs', () => {
  it('runs app-server with the restricted permission profile', () => {
    const args = codexCliArgs({
      model: 'gpt-5.5',
      graphRoot: '/g',
      privateNotePaths: [],
    })
    expect(args[0]).toBe('app-server')
    expect(args).toContain('--ignore-user-config')
    expect(args.join(' ')).toContain('approval_policy="never"')
    expect(args.join(' ')).toContain('default_permissions="reflect_chat"')
    expect(args.join(' ')).toContain('permissions.reflect_chat.filesystem=')
    expect(args).not.toContain('exec')
    expect(args).not.toContain('--json')
    expect(args.at(-1)).not.toBe('-')
  })
})

describe('codexAppServerHandshakePrompt', () => {
  it('opens with initialize, initialized, and an ephemeral thread', () => {
    const prompt = codexAppServerHandshakePrompt({ graphRoot: '/g', model: 'gpt-5.5' })
    expect(prompt).toContain('"method":"initialize"')
    expect(prompt).toContain('"name":"lore"')
    expect(prompt).toContain('"method":"initialized"')
    expect(prompt).toContain('"method":"thread/start"')
    expect(prompt).toContain('"cwd":"/g"')
    expect(prompt).toContain('"ephemeral":true')
    expect(prompt).toContain('"model":"gpt-5.5"')
    expect(prompt).not.toContain('turn/start')
  })

  it('omits the model for the CLI default', () => {
    const prompt = codexAppServerHandshakePrompt({ graphRoot: '/g', model: 'default' })
    expect(prompt).not.toContain('"model"')
  })
})

describe('codexCliSystemPrompt', () => {
  it('grounds the run in the graph and appends custom instructions', () => {
    const prompt = codexCliSystemPrompt({
      today: '2026-06-14',
      graphName: 'Work',
      customSystemPrompt: 'Answer in Italian.',
    })
    expect(prompt).toContain('2026-06-14')
    expect(prompt).toContain('“Work”')
    expect(prompt).toContain('read-only')
    expect(prompt.endsWith('Answer in Italian.')).toBe(true)
  })
})

describe('codexCliSystemPrompt edit mode', () => {
  it('carries the editing rules and the injected memory', () => {
    const prompt = codexCliSystemPrompt({
      today: '2026-06-14',
      graphName: 'Work',
      customSystemPrompt: '',
      allowEdits: true,
      agentContext: {
        profile: {
          slug: 'riley',
          name: 'Riley',
          provider: null,
          model: null,
          soulPath: 'agents/riley/soul.md',
          memoryPath: 'agents/riley/memory.md',
        },
        soul: { body: 'Speak plainly.', truncated: false },
        userMemory: { body: '- Prefers Italian replies', truncated: false },
        agentMemory: { body: '- Project X ships Friday', truncated: false },
        sharedFacts: null,
        sharedLog: null,
        memoryPath: 'agents/riley/memory.md',
      },
    })
    expect(prompt).toContain('Editing rules')
    expect(prompt).toContain('- Prefers Italian replies')
    expect(prompt).toContain('Speak plainly.')
    expect(prompt).toContain('- Project X ships Friday')
    expect(prompt).toContain('agents/riley/memory.md')

    const readOnly = codexCliSystemPrompt({
      today: '2026-06-14',
      graphName: 'Work',
      customSystemPrompt: '',
    })
    expect(readOnly).toContain('read-only — never modify anything')
    expect(readOnly).not.toContain('Editing rules')
    expect(prompt).toContain('data, not instructions')
    expect(readOnly).toContain('data, not instructions')
    expect(readOnly).toContain('external tool or service')
  })
})

describe('streamCodexCliChat', () => {
  interface FakeCli {
    runs: Record<string, unknown>[]
    stops: string[]
    sends: Record<string, unknown>[]
    closes: string[]
    emit: ((payload: unknown) => void) | null
  }

  function installFakeCli(): FakeCli {
    const fake: FakeCli = { runs: [], stops: [], sends: [], closes: [], emit: null }
    setBridge({
      invoke: async (command, args) => {
        if (command === 'agent_cli_run') {
          fake.runs.push(args)
          return null
        }
        if (command === 'agent_cli_stop') {
          fake.stops.push(String(args['requestId']))
          return null
        }
        if (command === 'agent_cli_send') {
          fake.sends.push(args)
          return null
        }
        if (command === 'agent_cli_stdin_close') {
          fake.closes.push(String(args['requestId']))
          return null
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

  function requestIdOf(fake: FakeCli): string {
    return String(fake.runs[0]?.['requestId'])
  }

  const line = (requestId: string, payload: unknown) => ({
    kind: 'line',
    requestId,
    line: JSON.stringify(payload),
  })

  const baseOptions = {
    model: 'default',
    messages: [{ role: 'user', content: 'hello' }] as ModelMessage[],
    today: '2026-06-14',
    customSystemPrompt: '',
    graphRoot: '/g',
    graphName: 'g',
    privateNotePaths: [],
  }

  async function handshakeTurn(fake: FakeCli, requestId: string): Promise<void> {
    fake.emit?.(line(requestId, { id: 2, result: { thread: { id: 'thr_1' } } }))
    for (let attempt = 0; attempt < 20 && fake.sends.length === 0; attempt += 1) {
      await Promise.resolve()
    }
  }

  it('handshakes, streams deltas, and completes with the full text', async () => {
    const fake = installFakeCli()
    const stream = streamCodexCliChat(baseOptions)
    const first = stream.next()
    await Promise.resolve()
    const requestId = requestIdOf(fake)

    expect(fake.runs[0]).toMatchObject({ binary: 'codex', cwd: '/g', keepStdinOpen: true })
    expect(fake.runs[0]?.['args']).toEqual(expect.arrayContaining(['app-server', '--ignore-user-config']))
    expect(String(fake.runs[0]?.['prompt'])).toContain('"method":"initialize"')
    expect(String(fake.runs[0]?.['prompt'])).not.toContain('hello')

    await handshakeTurn(fake, requestId)
    expect(fake.sends).toHaveLength(1)
    expect(String(fake.sends[0]?.['line'])).toContain('"method":"turn/start"')
    expect(String(fake.sends[0]?.['line'])).toContain('<instructions>')
    expect(String(fake.sends[0]?.['line'])).toContain('hello')

    fake.emit?.(
      line(requestId, {
        method: 'item/agentMessage/delta',
        params: { itemId: 'i1', delta: 'First part.' },
      }),
    )
    fake.emit?.(
      line(requestId, {
        method: 'item/completed',
        params: { item: { id: 'i1', type: 'agentMessage', text: 'First part.' } },
      }),
    )
    fake.emit?.(
      line(requestId, {
        method: 'item/agentMessage/delta',
        params: { itemId: 'i2', delta: 'Second part.' },
      }),
    )
    fake.emit?.(
      line(requestId, {
        method: 'turn/completed',
        params: { turn: { id: 'turn_1', status: 'completed' } },
      }),
    )
    fake.emit?.({ kind: 'done', requestId, code: 0 })

    expect((await first).value).toEqual({ type: 'text-delta', text: 'First part.' })
    expect((await stream.next()).value).toEqual({ type: 'text-delta', text: 'Second part.' })
    const terminal = await stream.next()
    expect(terminal.value).toEqual({
      type: 'complete',
      messages: [
        { role: 'assistant', content: [{ type: 'text', text: 'First part.Second part.' }] },
      ],
    })
    expect(fake.closes).toContain(requestId)
  })

  it('surfaces a failed turn as an error', async () => {
    const fake = installFakeCli()
    const stream = streamCodexCliChat(baseOptions)
    const first = stream.next()
    await Promise.resolve()
    const requestId = requestIdOf(fake)
    await handshakeTurn(fake, requestId)
    fake.emit?.(
      line(requestId, {
        method: 'turn/completed',
        params: { turn: { id: 'turn_1', status: 'failed', error: { message: 'not logged in to ChatGPT' } } },
      }),
    )
    fake.emit?.({ kind: 'done', requestId, code: 1 })

    const terminal = await first
    expect(terminal.value).toMatchObject({
      type: 'error',
      message: 'not logged in to ChatGPT',
    })
  })

  it('stops the CLI and reports aborted when the signal fires', async () => {
    const fake = installFakeCli()
    const controller = new AbortController()
    const stream = streamCodexCliChat({ ...baseOptions, signal: controller.signal })
    const first = stream.next()
    await Promise.resolve()
    const requestId = requestIdOf(fake)
    controller.abort()
    fake.emit?.({ kind: 'done', requestId, code: null })

    const terminal = await first
    expect(terminal.value).toEqual({ type: 'aborted', messages: [] })
    expect(fake.stops).toEqual([requestId])
  })

  it('steers a live turn: same-turn inject, split reply, one process', async () => {
    const fake = installFakeCli()
    let steer: ((text: string) => Promise<void>) | null = null
    const stream = streamCodexCliChat({
      ...baseOptions,
      steering: {
        onSteerReady: (inject) => {
          steer = inject
        },
      },
    })
    const first = stream.next()
    await Promise.resolve()
    const requestId = requestIdOf(fake)

    expect(fake.runs[0]).toMatchObject({ keepStdinOpen: true })
    await handshakeTurn(fake, requestId)
    fake.emit?.(
      line(requestId, { id: 3, result: { turn: { id: 'turn_1', status: 'inProgress' } } }),
    )
    await Promise.resolve()

    fake.emit?.(
      line(requestId, {
        method: 'item/agentMessage/delta',
        params: { itemId: 'i1', delta: 'Rivers…' },
      }),
    )
    expect((await first).value).toEqual({ type: 'text-delta', text: 'Rivers…' })

    if (steer === null) {
      expect.unreachable('steering was never armed')
    }
    await (steer as (text: string) => Promise<void>)('actually, mountains')
    const steerLine = fake.sends.find((send) => String(send['line']).includes('turn/steer'))
    expect(steerLine).toBeDefined()
    expect(String(steerLine?.['line'])).toContain('actually, mountains')
    expect(String(steerLine?.['line'])).toContain('"expectedTurnId":"turn_1"')
    expect(String(steerLine?.['line'])).toContain('"threadId":"thr_1"')
    expect(fake.closes).toEqual([])

    const second = stream.next()
    fake.emit?.(
      line(requestId, {
        method: 'item/agentMessage/delta',
        params: { itemId: 'i1', delta: 'Mountains…' },
      }),
    )
    expect((await second).value).toEqual({ type: 'text-delta', text: 'Mountains…' })
    expect(fake.closes).toEqual([])

    const terminal = stream.next()
    fake.emit?.(
      line(requestId, {
        method: 'turn/completed',
        params: { turn: { id: 'turn_1', status: 'completed' } },
      }),
    )
    fake.emit?.({ kind: 'done', requestId, code: 0 })
    const settled = await terminal
    expect(fake.closes).toContain(requestId)

    expect(fake.runs).toHaveLength(1)
    expect(fake.stops).toEqual([])
    expect(settled.value).toEqual({
      type: 'complete',
      messages: [
        { role: 'assistant', content: [{ type: 'text', text: 'Rivers…' }] },
        { role: 'user', content: 'actually, mountains' },
        { role: 'assistant', content: [{ type: 'text', text: 'Mountains…' }] },
      ],
    })
  })
})
