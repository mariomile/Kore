import { afterEach, describe, expect, it } from 'vitest'
import type { ModelMessage } from 'ai'
import { setBridge } from '../ipc/bridge'
import { agentCliPrompt } from './agent-cli'
import {
  claudeCliArgs,
  claudeCliSettingsJson,
  claudeCliSystemPrompt,
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

  it('notes attachments instead of embedding their bytes', () => {
    const prompt = agentCliPrompt([
      {
        role: 'user',
        content: [
          { type: 'file', data: 'data:image/png;base64,xxx', mediaType: 'image/png' },
          { type: 'text', text: 'What is this?' },
        ],
      },
    ])
    expect(prompt).toContain('What is this?')
    expect(prompt).toContain('[1 attachment not shown]')
    expect(prompt).not.toContain('base64')
  })
})

describe('claudeCliSettingsJson', () => {
  it('denies private notes, the index, and git history by absolute path', () => {
    const parsed = JSON.parse(
      claudeCliSettingsJson('/graphs/work/', ['notes/secret.md', 'daily/2026-01-01.md']),
    ) as { permissions: { deny: string[] } }
    expect(parsed.permissions.deny).toContain('Read(//graphs/work/notes/secret.md)')
    expect(parsed.permissions.deny).toContain('Read(//graphs/work/daily/2026-01-01.md)')
    expect(parsed.permissions.deny).toContain('Read(//graphs/work/.reflect/**)')
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
      expect(parsed.permissions.deny).toContain(`${rule}(//graphs/work/.reflect/**)`)
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
    expect(parsed.permissions.deny).toContain('Read(//C:/graphs/work/.reflect/**)')
  })
})

describe('claudeCliArgs', () => {
  it('locks the run down to headless streaming with read-only tools', () => {
    const args = claudeCliArgs({ model: 'sonnet', systemPrompt: 'sys', settingsJson: '{}' })
    expect(args).toContain('-p')
    expect(args).toContain('--include-partial-messages')
    expect(args.join(' ')).toContain('--tools Read,Glob')
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
    expect(args.join(' ')).toContain('--tools Read,Glob,Write,Edit')
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
  })

  it('edit mode carries the editing rules and the injected memory', () => {
    const prompt = claudeCliSystemPrompt({
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
  })
})

describe('streamClaudeCliChat', () => {
  interface FakeCli {
    runs: Record<string, unknown>[]
    stops: string[]
    emit: ((payload: unknown) => void) | null
  }

  function installFakeCli(): FakeCli {
    const fake: FakeCli = { runs: [], stops: [], emit: null }
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
