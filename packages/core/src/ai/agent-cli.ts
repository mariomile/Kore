import { z } from 'zod'
import type { ModelMessage } from 'ai'
import { getBridge } from '../ipc/bridge'
import { call } from '../ipc/invoke'
import type { ChatStreamEvent } from './chat/stream-chat'

/**
 * Shared plumbing for the "subscription" AI providers — chat engines that
 * run a locally installed coding-agent CLI (Claude Code, Codex) in headless
 * mode instead of calling a provider API with a key. The Rust bridge spawns
 * the binary and relays stdout lines; this module owns the transport: the
 * event queue, abort wiring, transcript flattening, and the shared turn
 * skeleton that maps parsed lines onto the chat engine's
 * {@link ChatStreamEvent}s. Each binary's argument protocol and line format
 * live in its own module (`./claude-cli`, `./codex-cli`).
 */

/** The closed set of binaries the Rust bridge will run. */
export type AgentCliBinary = 'claude' | 'codex'

/**
 * Check that a CLI is installed and runnable; resolves with its version
 * string. These providers' whole "key validation".
 */
export async function checkAgentCli(binary: AgentCliBinary): Promise<string> {
  return await call('agent_cli_check', { binary }, z.string())
}

/** Rough transcript budget: the CLI re-reads notes itself, so history-only. */
const MAX_TRANSCRIPT_CHARS = 60_000

/** The readable text of one model message (attachments noted, not embedded). */
function messageText(message: ModelMessage): string {
  if (typeof message.content === 'string') {
    return message.content
  }
  const parts: string[] = []
  let attachments = 0
  for (const part of message.content) {
    if (part.type === 'text') {
      parts.push(part.text)
    } else if (part.type === 'file' || part.type === 'image') {
      attachments += 1
    }
  }
  if (attachments > 0) {
    parts.push(`[${attachments} ${attachments === 1 ? 'attachment' : 'attachments'} not shown]`)
  }
  return parts.join('\n').trim()
}

/**
 * Flatten the model-facing history into one headless prompt. The CLIs have
 * no conversation state across invocations, so prior turns ride along as a
 * transcript, oldest dropped first when the budget is exceeded.
 */
export function agentCliPrompt(messages: ModelMessage[]): string {
  const turns = messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({ role: message.role, text: messageText(message) }))
    .filter((turn) => turn.text !== '')
  const current = turns.pop()
  if (current === undefined) {
    return ''
  }
  const history: string[] = []
  let budget = MAX_TRANSCRIPT_CHARS - current.text.length
  for (const turn of [...turns].reverse()) {
    const block = `${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.text}`
    if (block.length > budget) {
      break
    }
    budget -= block.length
    history.unshift(block)
  }
  if (history.length === 0) {
    return current.text
  }
  return [
    'Previous conversation (for context):',
    '',
    ...history,
    '',
    'Current question:',
    current.text,
  ].join('\n')
}

/**
 * One parsed stdout line, reduced to what the chat stream needs. A
 * `text-delta` is a raw streaming fragment appended verbatim (Claude Code's
 * partial messages); a `text-block` is one complete message, joined onto any
 * earlier block with a blank line (Codex emits whole messages only).
 */
export type AgentCliChunk =
  | { type: 'text-delta'; text: string }
  | { type: 'text-block'; text: string }
  | { type: 'result'; isError: boolean; message: string | null }

const cliEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('line'), requestId: z.string(), line: z.string() }),
  z.object({ kind: z.literal('done'), requestId: z.string(), code: z.number().nullable() }),
  z.object({ kind: z.literal('failed'), requestId: z.string(), message: z.string() }),
])

const CLI_EVENT = 'agent-cli:event'

export interface AgentCliTurnOptions {
  binary: AgentCliBinary
  /** The complete argument list (each binary's protocol lives with its engine). */
  args: string[]
  /** The prompt written to the CLI's stdin. */
  prompt: string
  /** Working directory for the run — the graph root. */
  cwd: string
  /** Parse one stdout line into a chunk, or null for noise. */
  parseLine: (line: string) => AgentCliChunk | null
  /** Message when the spawn itself fails without a specific cause. */
  startFailureMessage: string
  /** Aborts the run mid-stream (the UI's stop button). */
  signal?: AbortSignal | undefined
}

/**
 * Run one headless CLI turn, yielding the same normalized
 * {@link ChatStreamEvent}s as the BYOK engine so the transcript renders
 * identically. The CLI's internal tool activity is not surfaced as chips
 * (its file reads are its own affair, like thinking); only answer text
 * streams — as deltas when the binary emits them, as one block otherwise.
 */
export async function* streamAgentCliTurn(
  options: AgentCliTurnOptions,
): AsyncGenerator<ChatStreamEvent> {
  const requestId = crypto.randomUUID()
  const queue: z.infer<typeof cliEventSchema>[] = []
  let wake: (() => void) | null = null
  const push = (payload: unknown): void => {
    const event = cliEventSchema.safeParse(payload)
    if (!event.success || event.data.requestId !== requestId) {
      return
    }
    queue.push(event.data)
    wake?.()
    wake = null
  }
  const unlisten = await getBridge().listen(CLI_EVENT, push)

  const onAbort = (): void => {
    void getBridge()
      .invoke('agent_cli_stop', { requestId })
      .catch(() => {})
  }
  options.signal?.addEventListener('abort', onAbort, { once: true })

  let text = ''
  const responseMessages = (): ModelMessage[] =>
    text === '' ? [] : [{ role: 'assistant', content: [{ type: 'text', text }] }]

  try {
    await getBridge().invoke('agent_cli_run', {
      requestId,
      binary: options.binary,
      args: options.args,
      prompt: options.prompt,
      cwd: options.cwd,
    })
  } catch (cause) {
    unlisten()
    options.signal?.removeEventListener('abort', onAbort)
    yield {
      type: 'error',
      message:
        cause instanceof Error && cause.message !== ''
          ? cause.message
          : options.startFailureMessage,
      messages: [],
    }
    return
  }

  let failure: string | null = null
  let resultError: string | null = null
  let completed = false
  try {
    while (true) {
      const event = queue.shift()
      if (event === undefined) {
        await new Promise<void>((resolve) => {
          wake = resolve
        })
        continue
      }
      if (event.kind === 'line') {
        const chunk = options.parseLine(event.line)
        if (chunk === null) {
          continue
        }
        if (chunk.type === 'text-delta') {
          text += chunk.text
          yield { type: 'text-delta', text: chunk.text }
        } else if (chunk.type === 'text-block') {
          const delta = text === '' ? chunk.text : `\n\n${chunk.text}`
          text += delta
          yield { type: 'text-delta', text: delta }
        } else if (chunk.isError) {
          resultError = chunk.message ?? 'The CLI reported an error.'
        }
      } else if (event.kind === 'failed') {
        failure = event.message
      } else {
        // done — decide the terminal event.
        if (options.signal?.aborted) {
          yield { type: 'aborted', messages: responseMessages() }
        } else if (resultError !== null || failure !== null || (event.code ?? 1) !== 0) {
          yield {
            type: 'error',
            message: resultError ?? failure ?? 'The CLI exited unexpectedly.',
            messages: responseMessages(),
          }
        } else {
          yield { type: 'complete', messages: responseMessages() }
        }
        completed = true
        return
      }
    }
  } finally {
    unlisten()
    options.signal?.removeEventListener('abort', onAbort)
    // A consumer that abandons the stream (conversation switch, unmount)
    // must not leave the CLI running headless in the background.
    if (!completed) {
      onAbort()
    }
  }
}
