import { isStepCount, streamText, type LanguageModel, type ModelMessage } from 'ai'
import { errorMessage } from '../../errors'
import { languageModel } from '../language-model'
import { modelContextWindow } from '../provider-catalog'
import type { AiProviderConfig } from '../../settings/schema'
import type { CloudGraphContext, CloudSafe } from '../checkers'
import type { AgentPromptContext } from '../agent-profiles'
import { fitToContextWindow } from './context-window'
import { chatSystemPrompt } from './system-prompt'
import {
  buildNoteTools,
  noteToolCall,
  noteToolResult,
  type NoteToolCall,
  type NoteToolDeps,
  type NoteToolResult,
} from './tools'

/**
 * The streaming chat engine (Plan 10, read-only first wave): one BYOK call
 * direct from the app to the user's provider, grounded in local notes via the
 * read-only tools. The provider SDK's stream is normalized into a small typed
 * event union so the UI renders text, tool activity, and errors from one
 * shape regardless of provider. Tool payloads stay opaque here — their
 * shapes (and the only code that knows tool names) live in `./tools`.
 */

/**
 * Ceiling on model↔tool round-trips per user turn. The model batches several
 * tool calls into each step, so this is generous headroom for multi-note
 * gathering rather than a tight budget — and the `prepareStep` hook below
 * guarantees the turn still ends with a reply when the ceiling is reached
 * mid-gather (see {@link streamChatTurn}).
 */
export const MAX_STEPS = 12

export interface StreamChatOptions {
  /** The provider entry to call, with `model` set to the model id to use. */
  config: AiProviderConfig
  /** The BYOK API key, or an empty string for no-key compatible endpoints. */
  apiKey: string
  /**
   * Transport for the provider call — the desktop passes its shell fetch
   * (CORS-free, host-allowlisted); tests pass a stub.
   */
  fetchFn: typeof fetch
  /** Full model-facing history including the new user message. */
  messages: ModelMessage[]
  /** Local ISO date for the system prompt (daily-note key space). */
  today: string
  /** Whether note search can use embeddings for meaning-based recall. */
  semanticSearchEnabled: boolean
  /** User-authored instructions appended to Kore's built-in system prompt. */
  customSystemPrompt: string
  /**
   * Graph overview for the system prompt (`loadChatGraphContext`), or
   * `null` to send the prompt without it — required so call sites decide
   * the degraded mode explicitly rather than forgetting the block.
   */
  context: CloudSafe<CloudGraphContext> | null
  /** The active agent's soul + memories for the system prompt. */
  agentContext?: AgentPromptContext | null
  /** The user's "Allow edits" chat setting — gates `set_note_property` and `edit_note`. */
  allowEdits?: boolean | undefined
  /** Effect overrides for the note tools (the desktop's write channel). */
  toolDeps?: NoteToolDeps | undefined
  /** Aborts the provider call mid-stream (the UI's stop button). */
  signal?: AbortSignal
  /** Mid-turn steering — see {@link ChatSteering}. */
  steering?: ChatSteering | undefined
}

/**
 * Mid-turn steering: once the turn is live, `onSteerReady` receives the
 * function that delivers one more user message into it. For the BYOK engine
 * that means cutting the in-flight generation at the SDK's safe point (the
 * completed steps stay paired, the interrupted step keeps its partial
 * text), appending the message as a user turn, and continuing on the
 * combined history — one turn, one transcript, nothing lost. The promise
 * resolves once the turn has taken the message and rejects when the turn
 * ends without doing so (already settled, stopped, or failed first);
 * callers then queue the message instead.
 */
export interface ChatSteering {
  onSteerReady: (steer: (text: string) => Promise<void>) => void
}

/** One normalized event in a chat turn's stream. */
export type ChatStreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; call: NoteToolCall }
  | { type: 'tool-result'; result: NoteToolResult }
  | { type: 'tool-error'; toolCallId: string; message: string }
  /** A user message steered into the turn, at the point the reply split around it. */
  | { type: 'steer'; text: string }
  | { type: 'error'; message: string; messages: ModelMessage[] }
  | { type: 'aborted'; messages: ModelMessage[] }
  | { type: 'complete'; messages: ModelMessage[] }

/**
 * Run one chat turn against the user's configured provider, yielding
 * normalized {@link ChatStreamEvent}s. The history is first fitted to the
 * model's context budget ({@link fitToContextWindow}) — a long conversation
 * trims its oldest turns here rather than erroring at the provider. See
 * {@link streamChatTurn} for the stream's contract.
 */
export function streamChat(options: StreamChatOptions): AsyncGenerator<ChatStreamEvent> {
  const messages = fitToContextWindow(options.messages, {
    contextWindow: modelContextWindow(options.config.provider, options.config.model),
    systemPrompt: chatSystemPrompt({
      today: options.today,
      context: options.context,
      semanticSearchEnabled: options.semanticSearchEnabled,
      customSystemPrompt: options.customSystemPrompt,
      agentContext: options.agentContext ?? null,
      allowEdits: options.allowEdits,
    }),
  })
  return streamChatTurn(languageModel(options.config, options.apiKey, options.fetchFn), {
    messages,
    today: options.today,
    semanticSearchEnabled: options.semanticSearchEnabled,
    customSystemPrompt: options.customSystemPrompt,
    context: options.context,
    agentContext: options.agentContext ?? null,
    allowEdits: options.allowEdits,
    toolDeps: options.toolDeps,
    signal: options.signal,
    steering: options.steering,
  })
}

/** {@link streamChatTurn}'s options: {@link StreamChatOptions} minus provider wiring. */
export interface ChatTurnOptions {
  /** Full model-facing history including the new user message. */
  messages: ModelMessage[]
  /** Local ISO date for the system prompt (daily-note key space). */
  today: string
  /** Whether note search can use embeddings for meaning-based recall. */
  semanticSearchEnabled: boolean
  /** User-authored instructions appended to Kore's built-in system prompt. */
  customSystemPrompt: string
  /** Graph overview for the system prompt, or `null` to omit the block. */
  context: CloudSafe<CloudGraphContext> | null
  /** The active agent's soul + memories for the system prompt. */
  agentContext?: AgentPromptContext | null
  /** The user's "Allow edits" chat setting — gates `set_note_property` and `edit_note`. */
  allowEdits?: boolean | undefined
  /** Aborts the provider call mid-stream (the UI's stop button). */
  signal?: AbortSignal | undefined
  /** Effect overrides for the note tools (desktop write channel, tests). */
  toolDeps?: NoteToolDeps | undefined
  /** Mid-turn steering — see {@link ChatSteering}. */
  steering?: ChatSteering | undefined
}

/** Why a steer's promise rejects when the turn ended before taking it. */
const STEER_TOO_LATE = 'The reply ended before the message could be steered in.'

interface PendingSteer {
  text: string
  resolve: () => void
  reject: (cause: Error) => void
}

/**
 * The engine under {@link streamChat}, taking a concrete model — the seam
 * tests drive with a mock model instead of a provider. The stream terminates
 * with exactly one of `complete`, `aborted`, or `error` — each carrying the
 * assistant/tool messages to append to the model history. For a cut-short
 * turn those are the completed steps' messages (kept properly paired — a
 * dangling tool call without its result would be rejected by providers on
 * the next turn) plus the interrupted step's partial text, so the history
 * the next turn resends matches what stayed on screen.
 *
 * A turn runs as one or more *legs*: a steer ({@link ChatSteering}) aborts
 * the leg in flight, keeps what it produced, appends the steer as a user
 * message, yields a `steer` event where the reply split, and starts the
 * next leg on the combined history. The terminal event carries every leg's
 * messages in order, steers included — so the persisted turn and the
 * history the next turn resends read exactly as the transcript does.
 */
export async function* streamChatTurn(
  model: LanguageModel,
  options: ChatTurnOptions,
): AsyncGenerator<ChatStreamEvent> {
  const leg: LegOptions = {
    tools: buildNoteTools({
      ...options.toolDeps,
      semanticSearchEnabled: options.semanticSearchEnabled,
      allowEdits: options.allowEdits,
    }),
    instructions: chatSystemPrompt({
      today: options.today,
      context: options.context,
      semanticSearchEnabled: options.semanticSearchEnabled,
      customSystemPrompt: options.customSystemPrompt,
      agentContext: options.agentContext ?? null,
      allowEdits: options.allowEdits,
    }),
  }

  // What finished legs contributed, each followed by the steer that ended it.
  let settled: ModelMessage[] = []
  // Steers received since the leg in flight started; they end that leg. Each
  // settles its caller's promise only once it is decided: resolved when the
  // next leg takes it, rejected when the turn ends first (Stop, an error, a
  // consumer that stopped listening) — the caller then queues it instead,
  // so a message the user already sent is never silently dropped.
  const pendingSteers: PendingSteer[] = []
  const rejectPending = (message: string) => {
    for (const steer of pendingSteers.splice(0)) {
      steer.reject(new Error(message))
    }
  }
  let inFlight: AbortController | null = null
  let done = false
  options.steering?.onSteerReady(
    (text: string): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        if (done) {
          reject(new Error(STEER_TOO_LATE))
          return
        }
        pendingSteers.push({ text, resolve, reject })
        inFlight?.abort()
      }),
  )

  try {
    for (;;) {
      const controller = new AbortController()
      inFlight = controller
      const outer = options.signal
      const forwardAbort = () => controller.abort()
      // A steer received while the previous leg wound down (the `steer`
      // yield is a suspension point) ends this leg before it starts.
      if (outer?.aborted === true || pendingSteers.length > 0) {
        controller.abort()
      }
      outer?.addEventListener('abort', forwardAbort)
      // streamLeg never throws — every failure comes back as its result.
      const result = yield* streamLeg(
        model,
        leg,
        [...options.messages, ...settled],
        controller.signal,
      )
      outer?.removeEventListener('abort', forwardAbort)
      // A steer only redirects a leg the user did not stop and that did not
      // fail — a stopped turn stays stopped; an error is reported as such.
      if (pendingSteers.length > 0 && outer?.aborted !== true && result.kind !== 'error') {
        const steers = pendingSteers.splice(0)
        settled = [
          ...settled,
          ...result.messages,
          ...steers.map((steer): ModelMessage => ({ role: 'user', content: steer.text })),
        ]
        for (const steer of steers) {
          steer.resolve()
          yield { type: 'steer', text: steer.text }
        }
        continue
      }
      done = true
      rejectPending(STEER_TOO_LATE)
      const messages = [...settled, ...result.messages]
      switch (result.kind) {
        case 'complete':
          yield { type: 'complete', messages }
          return
        case 'aborted':
          yield { type: 'aborted', messages }
          return
        case 'error':
          yield { type: 'error', message: result.message, messages }
          return
      }
    }
  } finally {
    done = true
    rejectPending(STEER_TOO_LATE)
    // A consumer that stops iterating mid-leg takes the provider call down
    // with it.
    inFlight?.abort()
    inFlight = null
  }
}

interface LegOptions {
  tools: ReturnType<typeof buildNoteTools>
  instructions: string
}

type LegResult =
  | { kind: 'complete'; messages: ModelMessage[] }
  | { kind: 'aborted'; messages: ModelMessage[] }
  | { kind: 'error'; message: string; messages: ModelMessage[] }

/**
 * One provider call with its tool loop. Returns how it ended and the
 * messages it contributed: the full response for a completed leg; for a
 * cut-short one, the completed steps' messages (properly paired) plus the
 * interrupted step's partial text.
 */
async function* streamLeg(
  model: LanguageModel,
  leg: LegOptions,
  messages: ModelMessage[],
  signal: AbortSignal,
): AsyncGenerator<ChatStreamEvent, LegResult> {
  // Messages for all *completed* steps (cumulative, assistant/tool pairs)…
  let stepMessages: ModelMessage[] = []
  // …and the text streamed so far in the step still in flight.
  let pendingText = ''
  const partialMessages = (): ModelMessage[] =>
    pendingText === ''
      ? stepMessages
      : [...stepMessages, { role: 'assistant', content: pendingText }]

  try {
    const result = streamText({
      model,
      instructions: leg.instructions,
      messages,
      tools: leg.tools,
      stopWhen: isStepCount(MAX_STEPS),
      // On the final permitted step, disable tools so the model must answer
      // from what it has already gathered. Without this a turn still calling
      // tools when the ceiling fires ends on a tool result with no reply — the
      // user sees tool activity, then silence. `stepNumber` counts completed
      // steps, so the last step that runs is `MAX_STEPS - 1`.
      prepareStep: ({ stepNumber }) => (stepNumber >= MAX_STEPS - 1 ? { toolChoice: 'none' } : {}),
      abortSignal: signal,
      // `step.response.messages` holds only the messages that step created,
      // so the running history is accumulated here rather than assigned.
      onStepEnd: (step) => {
        stepMessages = [...stepMessages, ...step.response.messages]
      },
    })

    for await (const part of result.stream) {
      switch (part.type) {
        case 'text-delta':
          pendingText += part.text
          yield { type: 'text-delta', text: part.text }
          break
        case 'finish-step':
          // onStepEnd has already folded this step's text into
          // stepMessages; only unfinished-step text may count as partial.
          pendingText = ''
          break
        case 'tool-call': {
          const call = noteToolCall(part)
          if (call) {
            yield { type: 'tool-call', call }
          }
          break
        }
        case 'tool-result': {
          const toolResult = noteToolResult(part)
          if (toolResult) {
            yield { type: 'tool-result', result: toolResult }
          }
          break
        }
        case 'tool-error':
          yield {
            type: 'tool-error',
            toolCallId: part.toolCallId,
            message: errorMessage(part.error),
          }
          break
        case 'abort':
          return { kind: 'aborted', messages: partialMessages() }
        case 'error':
          return { kind: 'error', message: errorMessage(part.error), messages: partialMessages() }
        default:
          break
      }
    }

    return { kind: 'complete', messages: await result.responseMessages }
  } catch (cause) {
    // Belt and braces: most failures surface as `error` parts above, but a
    // synchronous throw (bad config, aborted before first byte) lands here.
    if (signal.aborted) {
      return { kind: 'aborted', messages: partialMessages() }
    }
    return { kind: 'error', message: errorMessage(cause), messages: partialMessages() }
  }
}
