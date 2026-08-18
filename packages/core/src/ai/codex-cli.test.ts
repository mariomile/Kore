import { afterEach, describe, expect, it } from 'vitest'
import type { ModelMessage } from 'ai'
import { setBridge } from '../ipc/bridge'
import {
  codexCliArgs,
  codexCliFilesystemToml,
  codexCliSystemPrompt,
  parseCodexCliLine,
  streamCodexCliChat,
} from './codex-cli'

afterEach(() => {
  setBridge(null)
})

describe('parseCodexCliLine', () => {
  it('extracts completed agent messages', () => {
    const line = JSON.stringify({
      type: 'item.completed',
      item: { id: 'item_0', type: 'agent_message', text: 'Ciao' },
    })
    expect(parseCodexCliLine(line)).toEqual({ type: 'text-block', text: 'Ciao' })
  })

  it('drops activity items and noise', () => {
    expect(
      parseCodexCliLine(
        JSON.stringify({ type: 'item.completed', item: { id: 'i', type: 'reasoning', text: 'x' } }),
      ),
    ).toBeNull()
    expect(
      parseCodexCliLine(
        JSON.stringify({
          type: 'item.started',
          item: { id: 'i', type: 'command_execution', command: 'cat notes/a.md' },
        }),
      ),
    ).toBeNull()
    expect(parseCodexCliLine(JSON.stringify({ type: 'thread.started', thread_id: 't' }))).toBeNull()
    expect(parseCodexCliLine('not json')).toBeNull()
  })

  it('maps turn completion and failures to terminal results', () => {
    expect(parseCodexCliLine(JSON.stringify({ type: 'turn.completed', usage: {} }))).toEqual({
      type: 'result',
      isError: false,
      message: null,
    })
    expect(
      parseCodexCliLine(
        JSON.stringify({ type: 'turn.failed', error: { message: 'not logged in' } }),
      ),
    ).toEqual({ type: 'result', isError: true, message: 'not logged in' })
    expect(parseCodexCliLine(JSON.stringify({ type: 'error', message: 'boom' }))).toEqual({
      type: 'result',
      isError: true,
      message: 'boom',
    })
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

  it('escapes TOML string characters in paths', () => {
    const toml = codexCliFilesystemToml(String.raw`C:\graphs\work`, ['notes/"odd".md'])
    expect(toml).toContain(String.raw`"C:\\graphs\\work/**" = "read"`)
    expect(toml).toContain(String.raw`\"odd\"`)
  })
})

describe('codexCliArgs', () => {
  it('runs headless JSONL with the restricted permission profile', () => {
    const args = codexCliArgs({
      model: 'gpt-5.5',
      graphRoot: '/g',
      privateNotePaths: [],
    })
    expect(args.slice(0, 2)).toEqual(['exec', '--json'])
    expect(args).toContain('--ephemeral')
    expect(args.join(' ')).toContain('default_permissions="reflect_chat"')
    expect(args.join(' ')).toContain('permissions.reflect_chat.filesystem=')
    expect(args.join(' ')).toContain('--model gpt-5.5')
    expect(args.at(-1)).toBe('-')
  })

  it('omits the model flag for the CLI default', () => {
    const args = codexCliArgs({ model: 'default', graphRoot: '/g', privateNotePaths: [] })
    expect(args).not.toContain('--model')
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

describe('streamCodexCliChat', () => {
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

  it('emits whole messages, joined, and completes with the full text', async () => {
    const fake = installFakeCli()
    const stream = streamCodexCliChat(baseOptions)
    const first = stream.next()
    await Promise.resolve()
    const requestId = String(fake.runs[0]?.['requestId'])
    fake.emit?.(
      line(requestId, {
        type: 'item.completed',
        item: { id: 'i1', type: 'agent_message', text: 'First part.' },
      }),
    )
    fake.emit?.(
      line(requestId, {
        type: 'item.completed',
        item: { id: 'i2', type: 'agent_message', text: 'Second part.' },
      }),
    )
    fake.emit?.(line(requestId, { type: 'turn.completed', usage: {} }))
    fake.emit?.({ kind: 'done', requestId, code: 0 })

    expect((await first).value).toEqual({ type: 'text-delta', text: 'First part.' })
    expect((await stream.next()).value).toEqual({ type: 'text-delta', text: '\n\nSecond part.' })
    const terminal = await stream.next()
    expect(terminal.value).toEqual({
      type: 'complete',
      messages: [
        { role: 'assistant', content: [{ type: 'text', text: 'First part.\n\nSecond part.' }] },
      ],
    })
    // The prompt carries the instruction preamble plus the question, and the
    // run targets the codex binary in the graph root.
    expect(fake.runs[0]).toMatchObject({ binary: 'codex', cwd: '/g' })
    expect(String(fake.runs[0]?.['prompt'])).toContain('<instructions>')
    expect(String(fake.runs[0]?.['prompt'])).toContain('hello')
  })

  it('surfaces a failed turn as an error', async () => {
    const fake = installFakeCli()
    const stream = streamCodexCliChat(baseOptions)
    const first = stream.next()
    await Promise.resolve()
    const requestId = String(fake.runs[0]?.['requestId'])
    fake.emit?.(
      line(requestId, { type: 'turn.failed', error: { message: 'not logged in to ChatGPT' } }),
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
    const requestId = String(fake.runs[0]?.['requestId'])
    controller.abort()
    fake.emit?.({ kind: 'done', requestId, code: null })

    const terminal = await first
    expect(terminal.value).toEqual({ type: 'aborted', messages: [] })
    expect(fake.stops).toEqual([requestId])
  })
})
