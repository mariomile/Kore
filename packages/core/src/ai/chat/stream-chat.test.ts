import type { ModelMessage } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import { convertArrayToReadableStream, MockLanguageModelV3 } from 'ai/test'
import type {
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3Usage,
} from '@ai-sdk/provider'
import type { RetrievalHit } from '../../embeddings/retrieve'
import { cloudSafeGraphContext } from '../checkers'
import { languageModel } from '../language-model'
import { fitToContextWindow } from './context-window'
import { MAX_STEPS, streamChat, streamChatTurn, type ChatStreamEvent } from './stream-chat'

vi.mock('../language-model', () => ({
  languageModel: vi.fn(),
}))

vi.mock('./context-window', async (importOriginal) => {
  const original = await importOriginal<typeof import('./context-window')>()
  return {
    ...original,
    fitToContextWindow: vi.fn(original.fitToContextWindow),
  }
})

const languageModelMock = vi.mocked(languageModel)
const fitToContextWindowMock = vi.mocked(fitToContextWindow)

const USAGE: LanguageModelV3Usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
}

// Sentinels that cannot collide with prompt copy or fixture prose, so the
// not-in-payload assertions below can never pass vacuously.
const PRIVATE_TITLE = 'sentinel-title-01jxq3'
const PRIVATE_PATH = 'notes/sentinel-path-01jxq3.md'

function stream(parts: LanguageModelV3StreamPart[]): LanguageModelV3StreamResult {
  return {
    stream: convertArrayToReadableStream<LanguageModelV3StreamPart>([
      { type: 'stream-start', warnings: [] },
      { type: 'response-metadata', id: 'res', modelId: 'mock', timestamp: new Date(0) },
      ...parts,
    ]),
  }
}

/**
 * One stream result per doStream call, in order. (The mock's own array form
 * indexes by the post-push call count, skipping element 0 — a function keeps
 * the sequencing explicit instead.)
 */
function sequence(
  results: LanguageModelV3StreamResult[],
): () => Promise<LanguageModelV3StreamResult> {
  let index = 0
  return async () => {
    const next = results[index]
    index += 1
    if (next === undefined) {
      throw new Error(`mock model called ${index} times but only ${results.length} turns staged`)
    }
    return next
  }
}

function toolCallTurn(query: string, toolCallId = 'call-1') {
  return stream([
    {
      type: 'tool-call',
      toolCallId,
      toolName: 'search_notes',
      input: JSON.stringify({ query }),
    },
    { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: USAGE },
  ])
}

function textTurn(text: string) {
  return stream([
    { type: 'text-start', id: 'text-1' },
    { type: 'text-delta', id: 'text-1', delta: text },
    { type: 'text-end', id: 'text-1' },
    { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: USAGE },
  ])
}

async function collect(events: AsyncGenerator<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const all: ChatStreamEvent[] = []
  for await (const event of events) {
    all.push(event)
  }
  return all
}

const PUBLIC_HIT: RetrievalHit = {
  path: 'notes/atlas.md',
  title: 'Atlas Launch Plan',
  score: 1,
  snippet: 'launch plan',
  heading: null,
  isPrivate: false,
}

const PRIVATE_HIT: RetrievalHit = {
  path: PRIVATE_PATH,
  title: PRIVATE_TITLE,
  score: 0.9,
  snippet: '',
  heading: null,
  isPrivate: true,
}

describe('streamChat', () => {
  it('uses the custom system prompt for context accounting and the provider request', async () => {
    const customSystemPrompt = 'sentinel-custom-system-prompt-01jxq3'
    const messages: ModelMessage[] = [{ role: 'user', content: 'hello' }]
    const model = new MockLanguageModelV3({ doStream: sequence([textTurn('hi')]) })
    languageModelMock.mockReturnValue(model)

    await collect(
      streamChat({
        config: {
          id: 'cfg-openai',
          provider: 'openai',
          model: 'gpt-5.5',
          keyHint: 'wxyz1',
        },
        apiKey: 'sk-live-key',
        fetchFn: globalThis.fetch,
        messages,
        today: '2026-06-11',
        semanticSearchEnabled: true,
        customSystemPrompt,
        context: null,
      }),
    )

    const fitCall = fitToContextWindowMock.mock.calls.at(-1)
    if (fitCall === undefined) {
      expect.unreachable('expected context-window fitting')
    }
    expect(fitCall[0]).toBe(messages)
    expect(fitCall[1].systemPrompt).toContain(customSystemPrompt)

    expect(model.doStreamCalls).toHaveLength(1)
    expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).toContain(customSystemPrompt)
  })
})

describe('streamChatTurn', () => {
  it('streams tool activity, text, and a terminal complete event', async () => {
    const model = new MockLanguageModelV3({
      doStream: sequence([toolCallTurn('atlas'), textTurn('Found it: [[Atlas Launch Plan]]')]),
    })
    const events = await collect(
      streamChatTurn(model, {
        messages: [{ role: 'user', content: 'where is the launch plan?' }],
        today: '2026-06-11',
        semanticSearchEnabled: true,
        customSystemPrompt: '',
        context: null,
        toolDeps: {
          retrieveFn: async () => [PUBLIC_HIT, PRIVATE_HIT],
          readNoteFn: async () => 'launch plan\n',
        },
      }),
    )

    expect(events.map((event) => event.type)).toEqual([
      'tool-call',
      'tool-result',
      'text-delta',
      'complete',
    ])
    expect(events[0]).toEqual({
      type: 'tool-call',
      call: { tool: 'search', toolCallId: 'call-1', query: 'atlas' },
    })
    // The private hit is dropped before it ever reaches an event or payload.
    expect(events[1]).toEqual({
      type: 'tool-result',
      result: {
        tool: 'search',
        toolCallId: 'call-1',
        query: 'atlas',
        hits: [{ path: 'notes/atlas.md', title: 'Atlas Launch Plan' }],
      },
    })
    expect(events[2]).toMatchObject({ text: 'Found it: [[Atlas Launch Plan]]' })
    const complete = events.at(-1)
    expect(complete?.type === 'complete' && complete.messages.length > 0).toBe(true)
  })

  it('never sends private content in the outbound prompt (payload assertion)', async () => {
    const model = new MockLanguageModelV3({
      doStream: sequence([toolCallTurn('diary'), textTurn('done')]),
    })
    await collect(
      streamChatTurn(model, {
        messages: [{ role: 'user', content: 'what do my notes say?' }],
        today: '2026-06-11',
        semanticSearchEnabled: true,
        customSystemPrompt: '',
        context: null,
        toolDeps: {
          retrieveFn: async () => [PUBLIC_HIT, PRIVATE_HIT],
          readNoteFn: async () => 'launch plan\n',
        },
      }),
    )

    // Every prompt that left for the "provider", including the second step
    // carrying the tool result, must be free of the private note.
    expect(model.doStreamCalls.length).toBe(2)
    const outbound = JSON.stringify(model.doStreamCalls.map((call) => call.prompt))
    expect(outbound).not.toContain(PRIVATE_TITLE)
    expect(outbound).not.toContain(PRIVATE_PATH)
    expect(outbound).toContain('notes/atlas.md')
  })

  it('carries the graph overview in the outbound system prompt', async () => {
    const model = new MockLanguageModelV3({ doStream: sequence([textTurn('hi')]) })
    await collect(
      streamChatTurn(model, {
        messages: [{ role: 'user', content: 'hi' }],
        today: '2026-06-11',
        semanticSearchEnabled: true,
        customSystemPrompt: 'Challenge my assumptions before answering.',
        context: cloudSafeGraphContext({
          graphName: 'atlas-graph',
          noteCount: 7,
          dailyNoteCount: 2,
          earliestDailyDate: '2026-06-01',
          latestDailyDate: '2026-06-10',
          tags: [{ tag: 'book', count: 2 }],
          tagsTruncated: false,
        }),
      }),
    )

    const outbound = JSON.stringify(model.doStreamCalls[0]?.prompt)
    expect(outbound).toContain('atlas-graph')
    expect(outbound).toContain('#book (2)')
    expect(outbound).toContain('Daily notes span 2026-06-01 to 2026-06-10.')
    expect(outbound).toContain('Challenge my assumptions before answering.')
  })

  it('yields a terminal error event when the stream errors', async () => {
    const model = new MockLanguageModelV3({
      doStream: sequence([
        stream([
          { type: 'error', error: new Error('rate limited') },
          { type: 'finish', finishReason: { unified: 'error', raw: undefined }, usage: USAGE },
        ]),
      ]),
    })
    const events = await collect(
      streamChatTurn(model, {
        messages: [{ role: 'user', content: 'hi' }],
        today: '2026-06-11',
        semanticSearchEnabled: true,
        customSystemPrompt: '',
        context: null,
      }),
    )
    expect(events.at(-1)).toEqual({ type: 'error', message: 'rate limited', messages: [] })
  })

  it('a cut-short turn still carries the completed steps, properly paired', async () => {
    // Step 1 completes (tool call + result); step 2 streams text, then errors.
    const model = new MockLanguageModelV3({
      doStream: sequence([
        toolCallTurn('atlas'),
        stream([
          { type: 'text-start', id: 'text-1' },
          { type: 'text-delta', id: 'text-1', delta: 'So far' },
          { type: 'error', error: new Error('connection lost') },
          { type: 'finish', finishReason: { unified: 'error', raw: undefined }, usage: USAGE },
        ]),
      ]),
    })
    const events = await collect(
      streamChatTurn(model, {
        messages: [{ role: 'user', content: 'where is the launch plan?' }],
        today: '2026-06-11',
        semanticSearchEnabled: true,
        customSystemPrompt: '',
        context: null,
        toolDeps: { retrieveFn: async () => [PUBLIC_HIT], readNoteFn: async () => 'launch plan\n' },
      }),
    )

    const last = events.at(-1)
    if (last?.type !== 'error') {
      expect.unreachable('expected a terminal error event')
    }
    // The completed step's assistant (tool call) + tool (result) pair survives,
    // plus the interrupted step's partial text — never a dangling tool call.
    expect(last.messages.map((message) => message.role)).toEqual(['assistant', 'tool', 'assistant'])
    expect(JSON.stringify(last.messages.at(-1))).toContain('So far')
  })

  it('keeps every completed step when cut short after multiple tool rounds', async () => {
    // Pins the SDK semantic the engine relies on: each onStepEnd's
    // `response.messages` holds *only that step's* messages, so appending
    // (not assigning) yields the full paired history. If an `ai` upgrade ever
    // makes it cumulative again, this starts failing instead of silently
    // duplicating earlier rounds.
    const model = new MockLanguageModelV3({
      doStream: sequence([
        toolCallTurn('atlas', 'call-1'),
        toolCallTurn('budget', 'call-2'),
        stream([
          { type: 'text-start', id: 'text-1' },
          { type: 'text-delta', id: 'text-1', delta: 'So far' },
          { type: 'error', error: new Error('connection lost') },
          { type: 'finish', finishReason: { unified: 'error', raw: undefined }, usage: USAGE },
        ]),
      ]),
    })
    const events = await collect(
      streamChatTurn(model, {
        messages: [{ role: 'user', content: 'plan and budget?' }],
        today: '2026-06-11',
        semanticSearchEnabled: true,
        customSystemPrompt: '',
        context: null,
        toolDeps: { retrieveFn: async () => [PUBLIC_HIT], readNoteFn: async () => 'launch plan\n' },
      }),
    )

    const last = events.at(-1)
    if (last?.type !== 'error') {
      expect.unreachable('expected a terminal error event')
    }
    expect(last.messages.map((message) => message.role)).toEqual([
      'assistant',
      'tool',
      'assistant',
      'tool',
      'assistant',
    ])
    const outbound = JSON.stringify(last.messages)
    expect(outbound).toContain('call-1')
    expect(outbound).toContain('call-2')
  })

  describe('steering', () => {
    /**
     * A leg that streams `text` and then holds the stream open until the
     * call's abort signal fires — the shape a steer interrupts, and how a
     * real provider fetch behaves: the request errors out when aborted.
     */
    function heldTextTurn(text: string): LanguageModelV3StreamResult {
      return {
        stream: new ReadableStream<LanguageModelV3StreamPart>({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] })
            controller.enqueue({ type: 'text-start', id: 'text-1' })
            controller.enqueue({ type: 'text-delta', id: 'text-1', delta: text })
          },
        }),
      }
    }

    /** Like {@link sequence}, but each leg's stream tears down on abort. */
    function abortableSequence(
      results: LanguageModelV3StreamResult[],
    ): (options: { abortSignal?: AbortSignal }) => Promise<LanguageModelV3StreamResult> {
      const next = sequence(results)
      return async ({ abortSignal }) => {
        const result = await next()
        return {
          ...result,
          stream: new ReadableStream<LanguageModelV3StreamPart>({
            async start(controller) {
              const reader = result.stream.getReader()
              const onAbort = () => {
                controller.error(new DOMException('aborted', 'AbortError'))
                void reader.cancel()
              }
              abortSignal?.addEventListener('abort', onAbort, { once: true })
              for (;;) {
                const chunk = await reader.read()
                if (chunk.done) {
                  break
                }
                controller.enqueue(chunk.value)
              }
              abortSignal?.removeEventListener('abort', onAbort)
              if (abortSignal?.aborted !== true) {
                controller.close()
              }
            },
          }),
        }
      }
    }

    const OPTIONS = {
      messages: [{ role: 'user', content: 'plan a trip to the coast' }] as ModelMessage[],
      today: '2026-06-11',
      semanticSearchEnabled: true,
      customSystemPrompt: '',
      context: null,
    }

    it('keeps the partial reply, appends the steer, and continues the same turn', async () => {
      const model = new MockLanguageModelV3({
        doStream: abortableSequence([
          heldTextTurn('The coast is lovely in'),
          textTurn('Mountains, then.'),
        ]),
      })
      let steer: ((text: string) => Promise<void>) | null = null
      const events = streamChatTurn(model, {
        ...OPTIONS,
        steering: {
          onSteerReady: (inject) => {
            steer = inject
          },
        },
      })

      const seen: ChatStreamEvent[] = []
      // Pull until the first leg's text is on screen, then steer.
      const first = await events.next()
      seen.push(first.value as ChatStreamEvent)
      expect(seen[0]).toEqual({ type: 'text-delta', text: 'The coast is lovely in' })
      if (steer === null) {
        expect.unreachable('steering was never armed')
      }
      // The steer promise settles when the turn takes the message — which
      // happens as the stream is consumed, so it is awaited afterwards.
      const steered = (steer as (text: string) => Promise<void>)('actually, mountains')
      for await (const event of events) {
        seen.push(event)
      }
      await expect(steered).resolves.toBeUndefined()

      // One turn: partial text → the steer, where the reply split → the
      // continuation → a single terminal event.
      expect(seen.map((event) => event.type)).toEqual([
        'text-delta',
        'steer',
        'text-delta',
        'complete',
      ])
      expect(seen[1]).toEqual({ type: 'steer', text: 'actually, mountains' })
      expect(seen[2]).toEqual({ type: 'text-delta', text: 'Mountains, then.' })

      // The second leg saw the whole story in order: the question, what was
      // already said, then the steer.
      expect(model.doStreamCalls).toHaveLength(2)
      const secondPrompt = model.doStreamCalls[1]?.prompt ?? []
      const conversation = secondPrompt
        .filter((message) => message.role !== 'system')
        .map((message) => `${message.role}:${JSON.stringify(message.content)}`)
      expect(conversation).toHaveLength(3)
      expect(conversation[0]).toMatch(/^user:.*plan a trip to the coast/)
      expect(conversation[1]).toMatch(/^assistant:.*The coast is lovely in/)
      expect(conversation[2]).toMatch(/^user:.*actually, mountains/)

      // And the turn's history carries every leg with the steer between.
      const complete = seen.at(-1)
      if (complete?.type !== 'complete') {
        expect.unreachable('expected a terminal complete event')
      }
      expect(complete.messages.map((message) => message.role)).toEqual([
        'assistant',
        'user',
        'assistant',
      ])
      expect(JSON.stringify(complete.messages[0])).toContain('The coast is lovely in')
      expect(complete.messages[1]).toEqual({ role: 'user', content: 'actually, mountains' })
      expect(JSON.stringify(complete.messages[2])).toContain('Mountains, then.')
    })

    it('Stop during a steered leg ends the turn with everything so far', async () => {
      const model = new MockLanguageModelV3({
        doStream: abortableSequence([heldTextTurn('First leg'), heldTextTurn('Second leg')]),
      })
      const controller = new AbortController()
      let steer: ((text: string) => Promise<void>) | null = null
      const events = streamChatTurn(model, {
        ...OPTIONS,
        signal: controller.signal,
        steering: {
          onSteerReady: (inject) => {
            steer = inject
          },
        },
      })
      const seen: ChatStreamEvent[] = []
      seen.push((await events.next()).value as ChatStreamEvent)
      const inject = steer as unknown as (text: string) => Promise<void>
      // The steer's promise settles once the next leg has taken it.
      const firstSteer = inject('go on differently')
      seen.push((await events.next()).value as ChatStreamEvent)
      await expect(firstSteer).resolves.toBeUndefined()
      seen.push((await events.next()).value as ChatStreamEvent)
      expect(seen.map((event) => event.type)).toEqual(['text-delta', 'steer', 'text-delta'])

      // A steer accepted just before Stop is never taken: its promise
      // rejects so the caller can queue it — it does not vanish, and it
      // does not ride the history as an unanswered user message.
      const lateSteer = inject('and one more thing')
      lateSteer.catch(() => {})
      controller.abort()
      for await (const event of events) {
        seen.push(event)
      }
      const last = seen.at(-1)
      if (last?.type !== 'aborted') {
        expect.unreachable('expected a terminal aborted event')
      }
      expect(last.messages.map((message) => message.role)).toEqual([
        'assistant',
        'user',
        'assistant',
      ])
      expect(JSON.stringify(last.messages.at(-1))).toContain('Second leg')
      expect(JSON.stringify(last.messages)).not.toContain('and one more thing')
      expect(seen.filter((event) => event.type === 'steer')).toHaveLength(1)
      await expect(lateSteer).rejects.toThrow()

      // Once settled, a steer is refused so the caller can queue instead.
      await expect(inject('too late')).rejects.toThrow()
    })
  })

  it('disables tools on the final step so a tool-bound turn still answers', async () => {
    // Every gathering step calls a tool; the model only writes its answer
    // once tools are disabled on the last permitted step. Without that force,
    // the turn would end on a tool result with no reply.
    const gathering = Array.from({ length: MAX_STEPS - 1 }, (_unused, index) =>
      toolCallTurn(`query-${index}`, `call-${index}`),
    )
    const model = new MockLanguageModelV3({
      doStream: sequence([...gathering, textTurn('Summary: [[Atlas Launch Plan]]')]),
    })
    const events = await collect(
      streamChatTurn(model, {
        messages: [{ role: 'user', content: 'summarize everything' }],
        today: '2026-06-11',
        semanticSearchEnabled: true,
        customSystemPrompt: '',
        context: null,
        toolDeps: { retrieveFn: async () => [PUBLIC_HIT], readNoteFn: async () => 'body\n' },
      }),
    )

    // Every step ran, gathering steps kept tools on, and the final step was
    // forced to answer rather than call another tool.
    expect(model.doStreamCalls.length).toBe(MAX_STEPS)
    expect(model.doStreamCalls[0]?.toolChoice).toEqual({ type: 'auto' })
    expect(model.doStreamCalls.at(-1)?.toolChoice).toEqual({ type: 'none' })
    expect(events.at(-1)?.type).toBe('complete')
    expect(events.some((event) => event.type === 'text-delta')).toBe(true)
  })
})
