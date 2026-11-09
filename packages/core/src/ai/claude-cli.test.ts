import { afterEach, describe, expect, it } from 'vitest'
import type { FilePart, ModelMessage } from 'ai'
import { setBridge } from '../ipc/bridge'
import { agentCliInput, agentCliPrompt } from './agent-cli-input'
import {
  claudeCliAcceptsAttachment,
  claudeCliArgs,
  claudeCliSettingsJson,
  claudeCliSystemPrompt,
  createClaudeCliLineParser,
  claudeStreamJsonUserLine,
  parseClaudeCliLine,
  streamClaudeCliChat,
} from './claude-cli'

afterEach(() => {
  setBridge(null)
})

describe('parseClaudeCliLine', () => {
  it('extracts top-level assistant text deltas', () => {
    const line = JSON.stringify({
      type: 'stream_event',
      parent_tool_use_id: null,
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Ciao' } },
    })
    expect(parseClaudeCliLine(line)).toEqual({ type: 'text-delta', text: 'Ciao' })
  })

  it('drops subagent deltas, non-text deltas, and other event types', () => {
    const subagent = JSON.stringify({
      type: 'stream_event',
      parent_tool_use_id: 'tool-1',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } },
    })
    expect(parseClaudeCliLine(subagent)).toBeNull()
    const thinking = JSON.stringify({
      type: 'stream_event',
      parent_tool_use_id: null,
      event: { type: 'content_block_delta', delta: { type: 'thinking_delta' } },
    })
    expect(parseClaudeCliLine(thinking)).toBeNull()
    expect(parseClaudeCliLine(JSON.stringify({ type: 'system', subtype: 'init' }))).toBeNull()
    expect(parseClaudeCliLine('not json at all')).toBeNull()
  })

  it('surfaces the terminal result with its error flag', () => {
    expect(
      parseClaudeCliLine(JSON.stringify({ type: 'result', is_error: false, result: 'Ciao' })),
    ).toEqual({ type: 'result', isError: false, message: 'Ciao' })
    expect(parseClaudeCliLine(JSON.stringify({ type: 'result', is_error: true }))).toEqual({
      type: 'result',
      isError: true,
      message: null,
    })
  })
})

describe('createClaudeCliLineParser', () => {
  const root = '/Users/me/vault'

  it('turns tool calls and results into content-free steps, nesting subagent work', () => {
    const parse = createClaudeCliLineParser(root)
    const toolUse = (parentId: string | null, blocks: unknown[]): string =>
      JSON.stringify({
        type: 'assistant',
        parent_tool_use_id: parentId,
        message: { content: blocks },
      })
    const toolResult = (block: unknown, structured?: unknown): string =>
      JSON.stringify({
        type: 'user',
        parent_tool_use_id: null,
        message: { content: [block] },
        tool_use_result: structured,
      })

    expect(
      parse(
        toolUse(null, [
          {
            type: 'tool_use',
            id: 'agent-1',
            name: 'Agent',
            input: { description: 'Summarize alpha', subagent_type: 'general-purpose' },
          },
          { type: 'tool_use', id: 'glob-1', name: 'Glob', input: { pattern: 'notes/*.md' } },
        ]),
      ),
    ).toEqual([
      {
        type: 'step-start',
        step: {
          id: 'agent-1',
          tool: 'Agent',
          label: 'Subagent',
          detail: 'Summarize alpha',
          parentId: null,
        },
      },
      {
        type: 'step-start',
        step: {
          id: 'glob-1',
          tool: 'Glob',
          label: 'Find files',
          detail: 'notes/*.md',
          parentId: null,
        },
      },
    ])
    expect(
      parse(
        toolUse('agent-1', [
          {
            type: 'tool_use',
            id: 'read-1',
            name: 'Read',
            input: { file_path: `${root}/notes/alpha.md` },
          },
        ]),
      ),
    ).toEqual([
      {
        type: 'step-start',
        step: {
          id: 'read-1',
          tool: 'Read',
          label: 'Read',
          detail: 'notes/alpha.md',
          parentId: 'agent-1',
        },
      },
    ])
    // A successful read keeps a line count, never the note's text.
    expect(
      parse(
        toolResult(
          { type: 'tool_result', tool_use_id: 'read-1', content: '1\tSecret plans' },
          { type: 'text', file: { content: 'Secret plans', numLines: 3 } },
        ),
      ),
    ).toEqual([{ type: 'step-end', id: 'read-1', outcome: { error: null, summary: '3 lines' } }])
    // A denied call keeps the denial, so the user learns a note is off-limits.
    expect(
      parse(
        toolResult({
          type: 'tool_result',
          tool_use_id: 'glob-1',
          is_error: true,
          content:
            '<tool_use_error>File is in a directory that is denied by your permission settings.</tool_use_error>',
        }),
      ),
    ).toEqual([
      {
        type: 'step-end',
        id: 'glob-1',
        outcome: { error: 'Blocked — private or protected file', summary: null },
      },
    ])
  })
})

describe('agentCliPrompt', () => {
  it('sends a lone question verbatim', () => {
    expect(agentCliPrompt([{ role: 'user', content: 'What did I write?' }])).toBe(
      'What did I write?',
    )
  })

  it('carries prior turns as a transcript', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: [{ type: 'text', text: 'First answer' }] },
      { role: 'user', content: 'Follow-up' },
    ]
    const prompt = agentCliPrompt(messages)
    expect(prompt).toContain('User: First question')
    expect(prompt).toContain('Assistant: First answer')
    expect(prompt.endsWith('Current question:\nFollow-up')).toBe(true)
  })

  it('names attachments an engine cannot read instead of embedding their bytes', () => {
    const prompt = agentCliPrompt([
      {
        role: 'user',
        content: [
          {
            type: 'file',
            data: 'data:image/png;base64,xxx',
            mediaType: 'image/png',
            filename: 'cat.png',
          },
          { type: 'text', text: 'What is this?' },
        ],
      },
    ])
    expect(prompt).toContain('What is this?')
    expect(prompt).toContain('[Attachment: cat.png (image/png) — this engine cannot read it]')
    expect(prompt).not.toContain('base64')
  })
})

describe('agentCliInput', () => {
  it('labels readable attachments, newest first within the cap, across turns', () => {
    const file = (name: string): FilePart => ({
      type: 'file',
      data: `data:image/png;base64,${name}`,
      mediaType: 'image/png',
      filename: `${name}.png`,
    })
    const input = agentCliInput(
      [
        { role: 'user', content: [file('old'), { type: 'text', text: 'First' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Seen' }] },
        { role: 'user', content: [file('new'), { type: 'text', text: 'And this?' }] },
      ],
      claudeCliAcceptsAttachment,
    )
    expect(input.attachments.map((attachment) => attachment.label)).toEqual([
      'Attachment 1: old.png',
      'Attachment 2: new.png',
    ])
    expect(input.attachments[1]?.base64).toBe('new')
    expect(input.text).toContain('User: [Attachment 1: old.png]\nFirst')
    expect(input.text.endsWith('Current question:\n[Attachment 2: new.png]\nAnd this?')).toBe(true)
  })

  it('puts images and PDFs in the stream-json line as content blocks', () => {
    const line: unknown = JSON.parse(
      claudeStreamJsonUserLine('Compare them', [
        { label: 'Attachment 1: a.png', name: 'a.png', mediaType: 'image/png', base64: 'AAA' },
        {
          label: 'Attachment 2: b.pdf',
          name: 'b.pdf',
          mediaType: 'application/pdf',
          base64: 'BBB',
        },
      ]),
    )
    expect(line).toMatchObject({
      message: {
        content: [
          { type: 'text', text: 'Compare them' },
          { type: 'text', text: '[Attachment 1: a.png]' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } },
          { type: 'text', text: '[Attachment 2: b.pdf]' },
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: 'BBB' },
          },
        ],
      },
    })
  })
})

describe('claudeCliSettingsJson', () => {
  it('denies private notes, the index, and git history by absolute path', () => {
    const parsed = JSON.parse(
      claudeCliSettingsJson('/graphs/work/', ['notes/secret.md', 'daily/2026-01-01.md']),
    ) as { permissions: { deny: string[] } }
    expect(parsed.permissions.deny).toContain('Read(//graphs/work/notes/secret.md)')
    expect(parsed.permissions.deny).toContain('Read(//graphs/work/daily/2026-01-01.md)')
    expect(parsed.permissions.deny).toContain('Read(//graphs/work/.kore/**)')
    expect(parsed.permissions.deny).toContain('Read(//graphs/work/.git/**)')
    for (const tool of ['Grep', 'Bash', 'Write', 'Edit', 'WebSearch', 'WebFetch']) {
      expect(parsed.permissions.deny).toContain(tool)
    }
  })

  it('edit mode lifts the global Write/Edit denies but keeps every fence', () => {
    const parsed = JSON.parse(claudeCliSettingsJson('/graphs/work', ['notes/secret.md'], true)) as {
      permissions: { deny: string[] }
    }
    for (const rule of ['Read', 'Write', 'Edit']) {
      expect(parsed.permissions.deny).toContain(`${rule}(//graphs/work/notes/secret.md)`)
      expect(parsed.permissions.deny).toContain(`${rule}(//graphs/work/.kore/**)`)
      expect(parsed.permissions.deny).toContain(`${rule}(//graphs/work/.git/**)`)
    }
    expect(parsed.permissions.deny).not.toContain('Write')
    expect(parsed.permissions.deny).not.toContain('Edit')
    expect(parsed.permissions.deny).toContain('Bash')
    expect(parsed.permissions.deny).toContain('Grep')
  })

  it('anchors a Windows drive root the same way instead of failing open', () => {
    const parsed = JSON.parse(
      claudeCliSettingsJson(String.raw`C:\graphs\work`, ['notes/secret.md']),
    ) as {
      permissions: { deny: string[] }
    }
    expect(parsed.permissions.deny).toContain('Read(//C:/graphs/work/notes/secret.md)')
    expect(parsed.permissions.deny).toContain('Read(//C:/graphs/work/.kore/**)')
  })
})

describe('claudeCliArgs', () => {
  it('locks the run down to headless streaming with read-only tools', () => {
    const args = claudeCliArgs({ model: 'sonnet', systemPrompt: 'sys', settingsJson: '{}' })
    expect(args).toContain('-p')
    expect(args).toContain('--include-partial-messages')
    expect(args.join(' ')).toContain('--tools Read,Glob,Task ')
    expect(args.join(' ')).toContain('--model sonnet')
  })

  it('omits --model for the CLI default', () => {
    const args = claudeCliArgs({ model: 'default', systemPrompt: 'sys', settingsJson: '{}' })
    expect(args).not.toContain('--model')
  })

  it('edit mode adds the write tools', () => {
    const args = claudeCliArgs({
      model: 'default',
      systemPrompt: 'sys',
      settingsJson: '{}',
      allowEdits: true,
    })
    expect(args.join(' ')).toContain('--tools Read,Glob,Task,Write,Edit')
  })

  it('read mode with MCP servers mounts the config but keeps read-only tools', () => {
    const args = claudeCliArgs({
      model: 'default',
      systemPrompt: 'sys',
      settingsJson: '{}',
      mcpServers: [
        { name: 'linear', transport: { kind: 'http', url: 'https://mcp.linear.app' }, env: {} },
      ],
    })
    expect(args.join(' ')).toContain('--tools Read,Glob')
    expect(args.join(' ')).not.toContain('Write')
    expect(args).toContain('--strict-mcp-config')
    const configIndex = args.indexOf('--mcp-config')
    expect(configIndex).toBeGreaterThan(-1)
    expect(args[configIndex + 1]).toContain('linear')
  })

  it('read mode without MCP servers carries no MCP config at all', () => {
    const args = claudeCliArgs({ model: 'default', systemPrompt: 'sys', settingsJson: '{}' })
    expect(args).toContain('--strict-mcp-config')
    expect(args).not.toContain('--mcp-config')
  })
})

describe('claudeCliSystemPrompt', () => {
  it('grounds the run in the graph and appends custom instructions', () => {
    const prompt = claudeCliSystemPrompt({
      today: '2026-06-14',
      graphName: 'Work',
      customSystemPrompt: 'Answer in Italian.',
    })
    expect(prompt).toContain('2026-06-14')
    expect(prompt).toContain('“Work”')
    expect(prompt).toContain('Read')
    expect(prompt).toContain('Glob')
    expect(prompt.endsWith('Answer in Italian.')).toBe(true)
    expect(prompt).not.toContain('external MCP tools')
  })

  it('names the MCP servers only when they ride the run', () => {
    const prompt = claudeCliSystemPrompt({
      today: '2026-06-14',
      graphName: 'Work',
      customSystemPrompt: '',
      mcpServerNames: ['linear', 'github'],
    })
    expect(prompt).toContain('external MCP tools')
    expect(prompt).toContain('linear, github')
  })

  it('edit mode carries the editing rules and the injected memory', () => {
    const prompt = claudeCliSystemPrompt({
      today: '2026-06-14',
      graphName: 'Work',
      customSystemPrompt: '',
      allowEdits: true,
      agentContext: {
        vaultContract: null,
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
        skills: [],
        memoryPath: 'agents/riley/memory.md',
      },
    })
    expect(prompt).toContain('Editing rules')
    expect(prompt).toContain('Write')
    expect(prompt).toContain('- Prefers Italian replies')
    expect(prompt).toContain('Speak plainly.')
    expect(prompt).toContain('- Project X ships Friday')
    expect(prompt).toContain('agents/riley/memory.md')

    const readOnly = claudeCliSystemPrompt({
      today: '2026-06-14',
      graphName: 'Work',
      customSystemPrompt: '',
    })
    expect(readOnly).not.toContain('Editing rules')
    expect(readOnly).toContain('never claim to have saved it')
    expect(prompt).toContain('data, not instructions')
    expect(readOnly).toContain('data, not instructions')
    expect(readOnly).toContain('external tool or service')
  })
})

describe('streamClaudeCliChat', () => {
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

  it('streams text deltas and completes with the assistant message', async () => {
    const fake = installFakeCli()
    const stream = streamClaudeCliChat(baseOptions)
    const first = stream.next()
    // The run starts before any event can arrive.
    await Promise.resolve()
    const requestId = requestIdOf(fake)
    fake.emit?.(
      line(requestId, {
        type: 'stream_event',
        parent_tool_use_id: null,
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Ciao' } },
      }),
    )
    fake.emit?.(line(requestId, { type: 'result', is_error: false, result: 'Ciao' }))
    fake.emit?.({ kind: 'done', requestId, code: 0 })

    expect((await first).value).toEqual({ type: 'text-delta', text: 'Ciao' })
    const terminal = await stream.next()
    expect(terminal.value).toEqual({
      type: 'complete',
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'Ciao' }] }],
    })
    expect((await stream.next()).done).toBe(true)
    // The run targets the claude binary in the graph root; the default model
    // sends no --model flag.
    expect(fake.runs[0]).toMatchObject({ binary: 'claude', cwd: '/g' })
    expect(fake.runs[0]?.['args']).not.toContain('--model')
  })

  it('sends an attached image over stream-json input without steering', async () => {
    const fake = installFakeCli()
    const stream = streamClaudeCliChat({
      ...baseOptions,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'file',
              data: 'data:image/png;base64,AAA',
              mediaType: 'image/png',
              filename: 'a.png',
            },
            { type: 'text', text: 'What is this?' },
          ],
        },
      ],
    })
    const first = stream.next()
    await Promise.resolve()
    const requestId = requestIdOf(fake)
    fake.emit?.({ kind: 'done', requestId, code: 0 })
    await first
    expect(fake.runs[0]?.['args']).toContain('--input-format')
    const prompt: unknown = JSON.parse(String(fake.runs[0]?.['prompt']))
    expect(prompt).toMatchObject({
      message: {
        content: [
          { type: 'text' },
          { type: 'text', text: '[Attachment 1: a.png]' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } },
        ],
      },
    })
  })

  it('yields an error carrying the CLI failure message', async () => {
    const fake = installFakeCli()
    const stream = streamClaudeCliChat({ ...baseOptions, model: 'sonnet' })
    const first = stream.next()
    await Promise.resolve()
    const requestId = requestIdOf(fake)
    fake.emit?.({ kind: 'failed', requestId, message: 'not logged in' })
    fake.emit?.({ kind: 'done', requestId, code: 1 })

    const terminal = await first
    expect(terminal.value).toMatchObject({ type: 'error', message: 'not logged in' })
    expect(fake.runs[0]?.['args']).toContain('sonnet')
  })

  it('stops the CLI and reports aborted when the signal fires', async () => {
    const fake = installFakeCli()
    const controller = new AbortController()
    const stream = streamClaudeCliChat({ ...baseOptions, signal: controller.signal })
    const first = stream.next()
    await Promise.resolve()
    const requestId = requestIdOf(fake)
    controller.abort()
    fake.emit?.({ kind: 'done', requestId, code: null })

    const terminal = await first
    expect(terminal.value).toEqual({ type: 'aborted', messages: [] })
    expect(fake.stops).toEqual([requestId])
  })

  it('finishes when Claude absorbs a steer into the active turn', async () => {
    const fake = installFakeCli()
    let steer: ((text: string) => Promise<void>) | null = null
    const stream = streamClaudeCliChat({
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

    // Streaming input: stdin stays open and the prompt itself rides as a
    // stream-json user line.
    expect(fake.runs[0]).toMatchObject({ keepStdinOpen: true })
    expect(fake.runs[0]?.['args']).toContain('--input-format')
    expect(String(fake.runs[0]?.['prompt'])).toContain('"type":"user"')

    fake.emit?.(
      line(requestId, {
        type: 'stream_event',
        parent_tool_use_id: null,
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Rivers…' } },
      }),
    )
    expect((await first).value).toEqual({ type: 'text-delta', text: 'Rivers…' })

    // Steer mid-turn: the message goes down the held-open stdin.
    if (steer === null) {
      expect.unreachable('steering was never armed')
    }
    await (steer as (text: string) => Promise<void>)('actually, mountains')
    expect(fake.sends).toHaveLength(1)
    expect(String(fake.sends[0]?.['line'])).toContain('actually, mountains')
    expect(fake.closes).toEqual([])

    // Claude absorbs the message into this turn, so there is no extra result.
    const second = stream.next()
    fake.emit?.(
      line(requestId, {
        type: 'stream_event',
        parent_tool_use_id: null,
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Mountains…' } },
      }),
    )
    expect((await second).value).toEqual({ type: 'text-delta', text: 'Mountains…' })
    expect(fake.closes).toEqual([])

    const terminal = stream.next()
    fake.emit?.(line(requestId, { type: 'result', is_error: false, result: 'Mountains…' }))
    await Promise.resolve()
    // Exit depends on closing stdin; emitting done first would hide the hang.
    expect(fake.closes).toContain(requestId)
    fake.emit?.({ kind: 'done', requestId, code: 0 })
    const settled = await terminal

    // One process for the whole exchange — the steer never relaunched it —
    // and the history keeps the real order: reply, steer, reply.
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

  it('keeps draining a queued follow-up after the first result closes stdin', async () => {
    const fake = installFakeCli()
    let steer: ((text: string) => Promise<void>) | null = null
    const stream = streamClaudeCliChat({
      ...baseOptions,
      steering: { onSteerReady: (inject) => (steer = inject) },
    })
    const first = stream.next()
    await Promise.resolve()
    const requestId = requestIdOf(fake)
    fake.emit?.(
      line(requestId, {
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'First.' } },
      }),
    )
    await first
    if (steer === null) {
      expect.unreachable('steering was never armed')
    }
    await (steer as (text: string) => Promise<void>)('follow up')

    const second = stream.next()
    fake.emit?.(line(requestId, { type: 'result', is_error: false, result: 'First.' }))
    fake.emit?.(
      line(requestId, {
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Second.' } },
      }),
    )
    expect((await second).value).toEqual({ type: 'text-delta', text: 'Second.' })
    expect(fake.closes).toContain(requestId)
    const terminal = stream.next()
    fake.emit?.(line(requestId, { type: 'result', is_error: false, result: 'Second.' }))
    fake.emit?.({ kind: 'done', requestId, code: 0 })
    expect((await terminal).value).toEqual({
      type: 'complete',
      messages: [
        { role: 'assistant', content: [{ type: 'text', text: 'First.' }] },
        { role: 'user', content: 'follow up' },
        { role: 'assistant', content: [{ type: 'text', text: 'Second.' }] },
      ],
    })
  })

  it('yields an error when the CLI cannot start', async () => {
    setBridge({
      invoke: async (command) => {
        if (command === 'agent_cli_run') {
          throw new Error('Claude Code CLI (`claude`) was not found')
        }
        return null
      },
      listen: async () => () => {},
    })
    const stream = streamClaudeCliChat(baseOptions)
    const terminal = await stream.next()
    expect(terminal.value).toMatchObject({
      type: 'error',
      message: expect.stringContaining('not found'),
    })
  })
})
